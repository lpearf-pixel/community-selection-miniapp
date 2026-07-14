from pathlib import Path

path = Path('scripts/verify-report-publish-local.ts')
source = path.read_text(encoding='utf-8')
old = "for (const requiredQuality of ['高风险：暂无自动发现', '中风险：暂无自动发现', '未完成项：暂无自动发现']) assert(l44Report.includes(requiredQuality), `L44 report quality summary missing: ${requiredQuality}`);"
new = """for (const requiredQuality of ['高风险：暂无自动发现', '中风险：暂无自动发现']) {
  assert(l44Report.includes(requiredQuality), `L44 report quality summary missing: ${requiredQuality}`);
}
const unfinishedSection = l44Report.split('## 10. 未完成项')[1]?.split('## 11. Codex 给人工 reviewer 的说明')[0] ?? '';
assert(unfinishedSection.trim() === '暂无自动发现', `L44 report unfinished section must be empty; actual=${unfinishedSection.trim()}`);"""
if old not in source:
    raise SystemExit('target assertion not found')
path.write_text(source.replace(old, new), encoding='utf-8')
