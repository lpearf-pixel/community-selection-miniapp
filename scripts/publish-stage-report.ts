import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const repoRoot = process.cwd();
const defaultBranch = 'stage-reports';
const pushFlagName = 'push';
const noPushFlagName = 'no-push';
const noPushCliFlag = '--no-push';
const worktreePath = join(repoRoot, '.tmp/stage-reports-worktree');

type RunOptions = { cwd?: string; allowFailure?: boolean; stdio?: 'pipe' | 'inherit' };

function argValue(name: string) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string) {
  return process.argv.includes(`--${name}`);
}

function run(command: string, args: string[], options: RunOptions = {}) {
  try {
    return execFileSync(command, args, {
      cwd: options.cwd ?? repoRoot,
      encoding: 'utf8',
      stdio: options.stdio === 'inherit' ? 'inherit' : ['ignore', 'pipe', 'pipe']
    })?.toString().trim() ?? '';
  } catch (error) {
    if (options.allowFailure) return '';
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${command} ${args.join(' ')} failed: ${message}`);
  }
}

function runGit(args: string[], options: RunOptions = {}) {
  return run('git', args, options);
}

function ensureCleanWorkspaceForPublishing() {
  const status = runGit(['status', '--porcelain']);
  const blocking = status.split('\n').map((line) => line.trim()).filter(Boolean).filter((line) => {
    const file = line.slice(3);
    return !(file.startsWith('reports/') || file.startsWith('.tmp/'));
  });
  if (blocking.length) {
    throw new Error(`当前工作区存在未提交变更，请先 commit 或 stash，再发布报告。\n${blocking.join('\n')}`);
  }
}

function timestampUtc() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function ensureReportBranch(branch: string) {
  runGit(['worktree', 'remove', relative(repoRoot, worktreePath), '--force'], { allowFailure: true });
  rmSync(worktreePath, { recursive: true, force: true });
  const localExists = Boolean(runGit(['rev-parse', '--verify', branch], { allowFailure: true }));
  if (localExists) {
    runGit(['worktree', 'add', relative(repoRoot, worktreePath), branch]);
    return;
  }

  runGit(['fetch', 'origin', `${branch}:${branch}`], { allowFailure: true });
  const fetchedExists = Boolean(runGit(['rev-parse', '--verify', branch], { allowFailure: true }));
  if (fetchedExists) {
    runGit(['worktree', 'add', relative(repoRoot, worktreePath), branch]);
    return;
  }

  runGit(['worktree', 'add', '--detach', relative(repoRoot, worktreePath)]);
  runGit(['checkout', '--orphan', branch], { cwd: worktreePath });
  runGit(['rm', '-rf', '.'], { cwd: worktreePath, allowFailure: true });
  writeFileSync(join(worktreePath, 'README.md'), '# Stage Reports\n\nThis branch stores generated stage verification reports.\n');
  runGit(['add', 'README.md'], { cwd: worktreePath });
  runGit(['commit', '-m', 'chore: initialize stage reports branch'], { cwd: worktreePath });
}

function copyReportFiles(input: { stage: string; branch: string; sourceBranch: string; sourceCommit: string; timestamp: string; reportFile: string; verifyOutputFile: string }) {
  const stageDir = join(worktreePath, 'reports', input.stage);
  const historyDir = join(stageDir, 'history');
  mkdirSync(historyDir, { recursive: true });

  const historyReport = `${input.timestamp}-stage-${input.stage}-report.md`;
  const historyVerify = `${input.timestamp}-verify-output.txt`;
  copyFileSync(input.reportFile, join(stageDir, 'latest.md'));
  copyFileSync(input.verifyOutputFile, join(stageDir, 'latest-verify-output.txt'));
  copyFileSync(input.reportFile, join(historyDir, historyReport));
  copyFileSync(input.verifyOutputFile, join(historyDir, historyVerify));

  const metadata = {
    stage: input.stage,
    source_branch: input.sourceBranch,
    source_commit: input.sourceCommit,
    report_branch: input.branch,
    generated_at: new Date().toISOString(),
    latest_report: 'latest.md',
    latest_verify_output: 'latest-verify-output.txt'
  };
  writeFileSync(join(stageDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
}

function main() {
  const stage = argValue('stage');
  if (!stage) throw new Error('缺少必填参数 --stage=Lxx');
  const branch = argValue('branch') ?? defaultBranch;
  const push = hasFlag(pushFlagName) && !hasFlag(noPushFlagName);

  ensureCleanWorkspaceForPublishing();
  const reportsDir = join(repoRoot, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const verifyOutputFile = join(reportsDir, 'latest-verify-output.txt');
  if (!existsSync(verifyOutputFile)) {
    console.error(`请先运行：\n\nmkdir -p reports\npnpm verify:all 2>&1 | tee reports/latest-verify-output.txt\n\n然后再执行：\n\npnpm report:publish -- --stage=${stage}`);
    process.exit(1);
  }

  run('pnpm', ['report:stage', '--', `--stage=${stage}`], { stdio: 'inherit' });
  const reportFile = join(reportsDir, `stage-${stage}-report.md`);
  if (!existsSync(reportFile)) throw new Error(`阶段报告不存在：${reportFile}`);

  const sourceBranch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  const sourceCommit = runGit(['rev-parse', 'HEAD']);
  const shortCommit = sourceCommit.slice(0, 8);
  const stamp = timestampUtc();

  ensureReportBranch(branch);
  copyReportFiles({ stage, branch, sourceBranch, sourceCommit, timestamp: stamp, reportFile, verifyOutputFile });

  runGit(['add', `reports/${stage}`], { cwd: worktreePath });
  const staged = runGit(['status', '--porcelain', `reports/${stage}`], { cwd: worktreePath });
  if (!staged) {
    console.log('报告内容无变化，无需提交');
  } else {
    runGit(['commit', '-m', `report: publish ${stage} verification report from ${shortCommit}`], { cwd: worktreePath, stdio: 'inherit' });
    console.log(`报告已提交到本地 ${branch} 分支。`);
  }

  if (push) {
    runGit(['push', 'origin', branch], { cwd: worktreePath, stdio: 'inherit' });
  } else {
    console.log(`如需上传远端，请运行：\n\ngit push origin ${branch}\n\n默认采用 ${noPushCliFlag}，不会上传远端。\n\n或者下次使用：\n\npnpm report:publish -- --stage=${stage} --push`);
  }

  runGit(['worktree', 'remove', relative(repoRoot, worktreePath), '--force'], { allowFailure: true });
}

try {
  main();
} catch (error) {
  runGit(['worktree', 'remove', relative(repoRoot, worktreePath), '--force'], { allowFailure: true });
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
