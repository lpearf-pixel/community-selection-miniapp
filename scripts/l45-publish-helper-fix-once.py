from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'missing target in {path}: {old[:160]!r}')
    p.write_text(text.replace(old, new, 1))

path = 'scripts/verify-report-publish-local.ts'
replace_once(
    path,
    "'L24-L45 chain regression', 'runtime_markers_required', 'l45TaxReviewConcurrentScenario', 'l45_tax_detail_success=true'",
    "'L24-L45 chain regression', 'runtime_markers_required', 'l45ConcurrentRuntimeMarkers', 'l45_tax_detail_success=true'",
)
replace_once(
    path,
    "for (const required of ['tax_record_list','tax_record_detail','tax_record_export','tax_review','mark_paid','fulfilled_count','applied_count','idempotent_count','runtime_markers_required','l45_tax_review_stale_version_409=true','l45_mark_paid_rollback_verified=true']) assert(l45ContractSource.includes(required), `L45 machine contract missing ${required}`);\nassert(l45ConcurrentRuntimeMarkers().every((marker) => generateSource.includes('l45ConcurrentRuntimeMarkers') || l45ContractSource.includes(marker.split('=')[0])), 'L45 report verifier must share concurrent marker helper semantics');",
    "for (const required of ['tax_record_list','tax_record_detail','tax_record_export','tax_review','mark_paid','fulfilled_count','applied_count','idempotent_count','runtime_markers_required','l45_tax_review_stale_version_409=true','l45_mark_paid_rollback_verified=true']) assert(l45ContractSource.includes(required), `L45 machine contract missing ${required}`);\nassert(l45ContractSource.includes('function l45TaxReviewConcurrentScenario()') && l45ContractSource.includes('function l45ConcurrentRuntimeMarkers()') && l45ContractSource.includes('const scenario = l45TaxReviewConcurrentScenario();'), 'L45 machine contract must keep a fail-closed concurrent scenario helper behind the shared marker helper');\nassert(generateSource.includes('l45ConcurrentRuntimeMarkers') && l45ConcurrentRuntimeMarkers().every((marker) => generateSource.includes('l45ConcurrentRuntimeMarkers') || l45ContractSource.includes(marker.split('=')[0])), 'L45 report generator must consume shared concurrent runtime marker semantics');",
)

doc = Path('docs/dev/stage-verifier-compatibility.md')
text = doc.read_text()
addition = """

## 16. Helper 包装层与静态门禁规范

- 静态 verifier 应验证公开契约、调用链和 fail-closed 语义，不得要求最终消费者直接引用某个内部 helper 名。
- 当消费者通过受控包装函数间接调用底层校验 helper 时，应分别验证包装函数被消费者使用、包装函数内部调用底层 helper，以及契约缺失时会失败。
- 禁止同时存在“共享包装 helper 已被消费”的语义检查，又额外要求消费者源码直接出现底层 helper 名；这种重复门禁会阻止等价重构。
"""
if '## 16. Helper 包装层与静态门禁规范' not in text:
    text += addition
doc.write_text(text)
