import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const repoRoot = process.cwd();
const defaultBranch = 'stage-reports';
const pushFlagName = 'push';
const noPushFlagName = 'no-push';
const noPushCliFlag = '--no-push';
const pullSourceFlagName = 'pull-source';
const skipSourceSyncCheckFlagName = 'skip-source-sync-check';
const pullSourceCliFlag = '--pull-source';
const skipSourceSyncCheckCliFlag = '--skip-source-sync-check';
const gitFetchOriginText = 'git fetch origin';
const gitPullFfOnlyText = 'git pull --ff-only';
const revListAheadBehindText = 'rev-list --left-right --count';
const originStageReportsRef = 'origin/stage-reports';
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

function parseAheadBehind(output: string) {
  const [aheadText, behindText] = output.trim().split(/\s+/);
  return { ahead: Number(aheadText ?? 0), behind: Number(behindText ?? 0) };
}

function remoteRefExists(ref: string) {
  return Boolean(runGit(['rev-parse', '--verify', ref], { allowFailure: true }));
}

function ensureSourceBranchSync(input: { pullSource: boolean; skipCheck: boolean; stage: string }) {
  const currentBranch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (currentBranch === 'HEAD') throw new Error('当前处于 detached HEAD，不能发布阶段报告。请切回开发分支。');
  if (input.skipCheck) return currentBranch;

  runGit(['fetch', 'origin']);
  const remoteRef = `origin/${currentBranch}`;
  if (!remoteRefExists(remoteRef)) {
    console.warn(`未找到 ${remoteRef}，跳过 source sync 检查。可手动执行 ${gitFetchOriginText} 后确认远端分支。`);
    return currentBranch;
  }

  const counts = parseAheadBehind(runGit(['rev-list', '--left-right', '--count', `HEAD...${remoteRef}`]));
  if (counts.behind > 0) {
    if (!input.pullSource) {
      throw new Error(`当前分支落后 ${remoteRef} ${counts.behind} 个 commit。
请先运行：
${gitPullFfOnlyText} origin ${currentBranch}
然后重新执行 report publish。`);
    }
    ensureCleanWorkspaceForPublishing();
    const beforePullCommit = runGit(['rev-parse', 'HEAD']);
    runGit(['pull', '--ff-only', 'origin', currentBranch], { stdio: 'inherit' });
    const afterPullCommit = runGit(['rev-parse', 'HEAD']);
    if (beforePullCommit !== afterPullCommit) {
      throw new Error(`当前分支已通过 --pull-source 更新到新 commit：
${beforePullCommit} -> ${afterPullCommit}

已有 reports/latest-verify-output.txt 可能对应旧 commit。
请重新运行 verify：

mkdir -p reports
pnpm verify:all 2>&1 | tee reports/latest-verify-output.txt
pnpm report:publish -- --stage=${input.stage} --push`);
    }
  }
  if (counts.ahead > 0) {
    console.warn(`当前分支领先 ${remoteRef} ${counts.ahead} 个 commit，报告 source_commit 可能尚未推送远端。`);
  }
  return currentBranch;
}

function fetchReportBranch(branch: string) {
  runGit(['fetch', 'origin', `${branch}:refs/remotes/origin/${branch}`], { allowFailure: true });
  return remoteRefExists(`origin/${branch}`);
}

function ensureReportBranch(branch: string) {
  runGit(['worktree', 'remove', relative(repoRoot, worktreePath), '--force'], { allowFailure: true });
  rmSync(worktreePath, { recursive: true, force: true });
  const remoteExists = fetchReportBranch(branch);
  const localExists = Boolean(runGit(['rev-parse', '--verify', branch], { allowFailure: true }));

  if (remoteExists && !localExists) {
    runGit(['branch', branch, `origin/${branch}`]);
  }

  if (remoteExists || localExists) {
    runGit(['worktree', 'add', relative(repoRoot, worktreePath), branch]);
    if (remoteExists) {
      try {
        runGit(['pull', '--ff-only', 'origin', branch], { cwd: worktreePath, stdio: 'inherit' });
      } catch (error) {
        throw new Error(`${branch} 本地分支无法快进到 origin/${branch}，请手动处理冲突。${error instanceof Error ? ` ${error.message}` : ''}`);
      }
    }
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

function ensureReportBranchSafeToPush(branch: string) {
  const remoteExists = fetchReportBranch(branch);
  if (!remoteExists) return;
  const counts = parseAheadBehind(runGit(['rev-list', '--left-right', '--count', `HEAD...origin/${branch}`], { cwd: worktreePath }));
  if (counts.behind > 0) {
    throw new Error(`${branch} 分支在提交报告后又落后远端，禁止 push。请重新执行 publish。`);
  }
}

function runStageReport(stage: string) {
  if (stage === 'L46') {
    run('pnpm', ['exec', 'tsx', 'scripts/generate-stage-report-entry.ts', `--stage=${stage}`], { stdio: 'inherit' });
    return;
  }
  if (stage === 'L47') {
    run('pnpm', ['exec', 'tsx', 'scripts/generate-stage-report-entry.ts', `--stage=${stage}`], { stdio: 'inherit' });
    return;
  }
  run('pnpm', ['report:stage', '--', `--stage=${stage}`], { stdio: 'inherit' });
}

function verifyStageReportBeforeCopy(stage: string) {
  if (stage === 'L46') {
    run('pnpm', ['exec', 'tsx', 'scripts/verify-l46-report-publish-local.ts', `--stage=${stage}`], { stdio: 'inherit' });
    return;
  }
  if (stage === 'L47') {
    run('pnpm', ['exec', 'tsx', 'scripts/verify-l47-report-publish-local.ts', `--stage=${stage}`], { stdio: 'inherit' });
  }
}

function main() {
  const stage = argValue('stage');
  if (!stage) throw new Error('缺少必填参数 --stage=Lxx');
  const branch = argValue('branch') ?? defaultBranch;
  const push = hasFlag(pushFlagName) && !hasFlag(noPushFlagName);
  const pullSource = hasFlag(pullSourceFlagName);
  const skipSourceSyncCheck = hasFlag(skipSourceSyncCheckFlagName);

  ensureCleanWorkspaceForPublishing();
  const sourceBranch = ensureSourceBranchSync({ pullSource, skipCheck: skipSourceSyncCheck, stage });
  const reportsDir = join(repoRoot, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const verifyOutputFile = join(reportsDir, 'latest-verify-output.txt');
  if (!existsSync(verifyOutputFile)) {
    console.error(`请先运行：

mkdir -p reports
pnpm verify:all 2>&1 | tee reports/latest-verify-output.txt

然后再执行：

pnpm report:publish -- --stage=${stage}`);
    process.exit(1);
  }

  runStageReport(stage);
  verifyStageReportBeforeCopy(stage);
  const reportFile = join(reportsDir, `stage-${stage}-report.md`);
  if (!existsSync(reportFile)) throw new Error(`阶段报告不存在：${reportFile}`);

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
    ensureReportBranchSafeToPush(branch);
    runGit(['push', 'origin', branch], { cwd: worktreePath, stdio: 'inherit' });
  } else {
    console.log(`如需上传远端，请运行：

git push origin ${branch}

默认采用 ${noPushCliFlag}，不会上传远端。可用 ${pullSourceCliFlag} 自动快进当前分支，或用 ${skipSourceSyncCheckCliFlag} 跳过 source sync 检查。

或者下次使用：

pnpm report:publish -- --stage=${stage} --push`);
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
