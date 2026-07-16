import { readFileSync, existsSync } from 'node:fs';
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(`L46 verifier: ${message}`); }
const files=['docs/plans/l46-admin-business-dashboard-v2.md','apps/api/src/modules/dashboard-v2/dashboard-v2-service.ts','apps/api/src/routes/admin/dashboard-v2.ts','apps/admin/src/api/adminDashboardV2.ts','apps/admin/src/pages/dashboard-v2/AdminBusinessDashboardV2Page.tsx','scripts/l46-dashboard-contract.ts'];
for(const file of files) assert(existsSync(file),`${file} missing`);
const route=readFileSync(files[2],'utf8'), service=readFileSync(files[1],'utf8'), contract=readFileSync(files[5],'utf8'), admin=readFileSync(files[4],'utf8');
for(const path of ['/overview','/trends','/alerts']) assert(route.includes(path),`${path} route missing`);
assert(service.includes('Intl.DateTimeFormat') && service.includes('maxDays'), 'period validation missing');
assert(service.includes('aggregate') && service.includes('groupBy'), 'database aggregation missing');
assert(route.includes('requireAdminPermission'), 'permission guard missing');
assert(admin.includes('AbortController') && admin.includes('requestAdminJson'), 'admin request safety/client missing');
for(const marker of ['l46_dashboard_scope_runtime=true','l46_dashboard_overview_success=true','l46_dashboard_permission_sections=true','l46_dashboard_trends_success=true','l46_dashboard_trends_stable=true','l46_dashboard_alerts_success=true','l46_dashboard_alerts_stable=true','l46_dashboard_tax_scope_db_query=true','l46_dashboard_no_sensitive_data=true','l46_dashboard_no_auto_action=true']) assert(contract.includes(marker),`marker missing: ${marker}`);
console.log('L46 dashboard static foundation checks passed.');
