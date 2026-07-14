import { readFileSync, existsSync } from 'node:fs';
function read(p:string){return readFileSync(p,'utf8')}
function assert(c:unknown,m:string):asserts c{if(!c)throw new Error(m)}
const schema=read('prisma/schema.prisma');
assert(existsSync('prisma/migrations/20260714000100_l44_manual_withdrawal_review/migration.sql'),'Withdrawal migration exists');
for (const f of ['client_request_id','reviewed_by_admin_id','reviewed_at','processed_by_admin_id','processed_at','manual_reference','rejected_at']) assert(schema.includes(f),`schema has ${f}`);
assert(schema.includes('client_request_id') && schema.includes('@unique'),'client_request_id unique');
const route=read('apps/api/src/routes/withdrawals.ts');
for (const s of ['resolveCurrentLeader','x-openid','withdrawal_reserved','withdrawal_rejected_restore','withdrawal_paid','withdrawal-reserved:${created.id}','withdrawal-rejected-restore:${id}','withdrawal-paid:${id}','updateMany','status: "available"','withdrawal_id: null','requireAdminPermission("withdrawal.manage")','requireWithdrawalDataScope']) assert(route.includes(s),`route includes ${s}`);
assert(!/leader_user_id:\s*body\.leader_user_id/.test(route),'body leader_user_id is not trusted');
const admin=read('apps/admin/src/pages/withdrawals/WithdrawalReviewPage.tsx');
assert(admin.includes('系统不会自动打款') && admin.includes('仅人工审核与人工处理记录'),'Admin page manual payout copy');
const e2e=read('scripts/verify-docker-api-e2e-local.ts');
assert(e2e.includes('verifyDockerApiE2E') || e2e.includes('main()'),'Docker E2E script exists for runtime assertions');
const all=[route,admin,read('apps/miniapp/pages/leader/withdrawals/index.wxml')].join('\n');
assert(!/AUTO_PAYOUT_ENABLED\s*=\s*true|银行API|微信代付|支付宝转账|payout SDK/i.test(all),'no real payout integration');
console.log('L44 manual withdrawal review verifier passed.');
