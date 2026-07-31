import {
  GLOBAL_STATIC_VERIFIERS,
  STAGE_REGISTRY,
} from './stage-registry.ts';

export type VerificationAuditCheck = {
  id: string;
  title: string;
  layer: 'foundation' | 'global-static' | 'historical-stage';
  command: string;
};

const command = (
  id: string,
  title: string,
  layer: VerificationAuditCheck['layer'],
  value: string,
): VerificationAuditCheck => ({ id, title, layer, command: value });

const seedFoundation: VerificationAuditCheck[] = [
  command('raw-compliance-terms', 'Raw compliance terms', 'foundation', 'pnpm exec tsx scripts/verify-no-raw-compliance-terms-local.ts'),
  command('db-generate', 'Generate Prisma client', 'foundation', 'pnpm db:generate'),
  command('db-migrate', 'Apply development migrations', 'foundation', 'pnpm db:migrate'),
  command('db-seed', 'Seed audit database', 'foundation', 'pnpm db:seed'),
  command('seed-check', 'Seed data contract', 'foundation', 'pnpm seed:check'),
];

const repositoryFoundation: VerificationAuditCheck[] = [
  command('typecheck', 'Workspace typecheck', 'foundation', 'pnpm typecheck'),
  command('lint', 'Workspace lint', 'foundation', 'pnpm lint'),
  command('test', 'Workspace tests', 'foundation', 'pnpm test'),
  command('build', 'Workspace build', 'foundation', 'pnpm build'),
  command('validate-env', 'Environment contract', 'foundation', 'pnpm exec tsx scripts/validate-env.ts'),
  command('check-migrations', 'Migration safety contract', 'foundation', 'pnpm exec tsx scripts/check-migrations.ts'),
  command('compliance-scan', 'Compliance scan', 'foundation', 'pnpm exec tsx scripts/compliance-scan.ts'),
];

const legacyStages: VerificationAuditCheck[] = [
  ['l10', 'L10 security', 'scripts/verify-l10-security-local.ts'],
  ['l11', 'L11 Admin auth', 'scripts/verify-l11-admin-auth-local.ts'],
  ['l12', 'L12 fulfillment', 'scripts/verify-l12-fulfillment-local.ts'],
  ['l13', 'L13 inventory purchase', 'scripts/verify-l13-inventory-purchase-local.ts'],
  ['l14', 'L14 batch supplier loss', 'scripts/verify-l14-batch-supplier-loss-local.ts'],
  ['l14-5', 'L14.5 modular boundary', 'scripts/verify-l14-5-modular-boundary-local.ts'],
  ['l15', 'L15 after-sale', 'scripts/verify-l15-after-sale-local.ts'],
  ['l16', 'L16 finance reconciliation', 'scripts/verify-l16-finance-reconciliation-local.ts'],
  ['l17', 'L17 operations dashboard', 'scripts/verify-l17-operations-dashboard-local.ts'],
  ['l17-5', 'L17.5 normal purchase', 'scripts/verify-l17-5-normal-purchase-local.ts'],
  ['l18', 'L18 user order center', 'scripts/verify-l18-user-order-center-local.ts'],
  ['l19', 'L19 product purchase entry', 'scripts/verify-l19-product-purchase-entry-local.ts'],
  ['l20', 'L20 miniapp release E2E', 'scripts/verify-l20-miniapp-e2e-release-local.ts'],
  ['l21', 'L21 miniapp location selection', 'scripts/verify-l21-miniapp-location-selection-local.ts'],
  ['l22', 'L22 miniapp order center', 'scripts/verify-l22-miniapp-order-center-local.ts'],
  ['l49', 'L49 brand home', 'scripts/verify-l49-brand-home-local.ts'],
  ['l23', 'L23 MVP release readiness', 'scripts/verify-l23-mvp-release-readiness-local.ts'],
].map(([id, title, file]) =>
  command(id, title, 'historical-stage', `pnpm exec tsx ${file}`),
);

const globalStatic = GLOBAL_STATIC_VERIFIERS.map((file, index) =>
  command(
    `global-static-${index + 1}`,
    `Global static verifier: ${file}`,
    'global-static',
    `pnpm exec tsx ${file}`,
  ),
);

const registeredStages = STAGE_REGISTRY
  .filter((stage) => stage.number >= 24 && stage.number <= 48)
  .flatMap((stage) => [
    ...(stage.number <= 47 ? [command(
      stage.id.toLowerCase(),
      `${stage.id}: ${stage.title}`,
      'historical-stage',
      `pnpm exec tsx ${stage.verifier}`,
    )] : []),
    ...(stage.additionalVerifiers ?? []).map((file, index) =>
      command(
        `${stage.id.toLowerCase()}-additional-${index + 1}`,
        `${stage.id} additional verifier: ${file}`,
        'historical-stage',
        `pnpm exec tsx ${file}`,
      ),
    ),
  ]);

const releaseGates: VerificationAuditCheck[] = [
  command(
    'l53-d2-compliance-release',
    'L53-D2 product compliance release gate',
    'historical-stage',
    'pnpm exec tsx scripts/verify-l53-d2-compliance-release-local.ts',
  ),
];

export const VERIFICATION_BASELINE_CHECKS: readonly VerificationAuditCheck[] = [
  ...seedFoundation,
  ...releaseGates,
  ...repositoryFoundation,
  ...legacyStages,
  ...globalStatic,
  ...registeredStages,
];
