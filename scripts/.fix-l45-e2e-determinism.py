from pathlib import Path

path = Path('scripts/verify-docker-api-e2e-local.ts')
source = path.read_text()
replacements = {
"""  const keywordFiltered = await request<{ items: Array<{ withdrawal_id: string }>; total: number }>('GET', `/api/admin/tax-records?keyword=${encodeURIComponent(leaderA.nickname ?? '')}`, { label: 'GET /api/admin/tax-records L45 keyword', headers: financeAHeaders });
  assert(keywordFiltered.total === 1 && keywordFiltered.items[0]?.withdrawal_id === fixtureA.withdrawal.id, 'L45 keyword must match an explicitly searchable fixture field');
""": """  const keywordFiltered = await request<{ items: Array<{ withdrawal_id: string }>; total: number }>('GET', `/api/admin/tax-records?keyword=${encodeURIComponent(fixtureA.withdrawal.id)}`, { label: 'GET /api/admin/tax-records L45 keyword', headers: financeAHeaders });
  assert(keywordFiltered.total === 1 && keywordFiltered.items.length === 1 && keywordFiltered.items[0].withdrawal_id === fixtureA.withdrawal.id, 'L45 keyword must match the explicitly searchable withdrawal id fixture');
""",
"""  const noScope = await request<{ items: unknown[]; total: number }>('GET', `/api/admin/tax-records?keyword=${encodeURIComponent(runId)}`, { label: 'GET /api/admin/tax-records L45 finance no scope', headers: financeNoScopeHeaders });
""": """  const noScope = await request<{ items: unknown[]; total: number }>('GET', '/api/admin/tax-records?page=1&page_size=20', { label: 'GET /api/admin/tax-records L45 finance no scope', headers: financeNoScopeHeaders });
""",
"""  const superAdmin = await request<{ items: Array<{ withdrawal_id: string }> }>('GET', `/api/admin/tax-records?page=1&page_size=20&keyword=${encodeURIComponent(runId)}`, { label: 'GET /api/admin/tax-records L45 super_admin', headers: adminHeaders });
  assert(superAdmin.items.some((item) => item.withdrawal_id === fixtureA.withdrawal.id) && superAdmin.items.some((item) => item.withdrawal_id === fixtureB.withdrawal.id), 'L45 super_admin must see all scopes');
""": """  const superAdminA = await request<{ items: Array<{ withdrawal_id: string }>; total: number }>('GET', `/api/admin/tax-records?withdrawal_id=${encodeURIComponent(fixtureA.withdrawal.id)}`, { label: 'GET /api/admin/tax-records L45 super_admin scope A', headers: adminHeaders });
  const superAdminB = await request<{ items: Array<{ withdrawal_id: string }>; total: number }>('GET', `/api/admin/tax-records?withdrawal_id=${encodeURIComponent(fixtureB.withdrawal.id)}`, { label: 'GET /api/admin/tax-records L45 super_admin scope B', headers: adminHeaders });
  assert(superAdminA.total === 1 && superAdminA.items[0]?.withdrawal_id === fixtureA.withdrawal.id && superAdminB.total === 1 && superAdminB.items[0]?.withdrawal_id === fixtureB.withdrawal.id, 'L45 super_admin must read explicit fixtures from both scopes');
""",
}
for old, new in replacements.items():
    if old not in source:
        raise SystemExit(f'missing expected block: {old[:120]!r}')
    source = source.replace(old, new, 1)
path.write_text(source)
