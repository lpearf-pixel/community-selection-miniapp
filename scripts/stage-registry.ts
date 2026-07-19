import { existsSync } from 'node:fs';
import { L47_RUNTIME_MARKERS } from './l47-center-contract.ts';
import { L48_RUNTIME_MARKERS } from './l48-security-privacy-contract.ts';

export type ReportContract = {
  sourceMode: 'git_diff';
  businessBaseBranch: string;
  businessBaseCommit: string;
};

export type StageDefinition = {
  id: string;
  number: number;
  title: string;
  verifier: string;
  additionalVerifiers?: readonly string[];
  baseBranch?: string;
  chainStart?: string;
  runtimeMarkers?: readonly string[];
  reportContract?: ReportContract;
};

export const REPORT_CONTRACTS: Record<string, ReportContract> = {
  L43: {
    sourceMode: 'git_diff',
    businessBaseBranch: 'stable/l42-business-base',
    businessBaseCommit: '20d5023f0e493bad7485e4fe8cbc5ccba014e118',
  },
  L44: {
    sourceMode: 'git_diff',
    businessBaseBranch: 'stable/l43-business-base',
    businessBaseCommit: '72a84e81218845c23872bd91ab58a03ccf4c0f33',
  },
  L45: {
    sourceMode: 'git_diff',
    businessBaseBranch: 'stable/l44-business-base',
    businessBaseCommit: '3ae666ec0e26383a5b117b64dce30b86a2dee389',
  },
  L46: {
    sourceMode: 'git_diff',
    businessBaseBranch: 'stable/l45-business-base',
    businessBaseCommit: '7e79bd4a701b1d0a071dd9a800f759a82098a1af',
  },
  L47: {
    sourceMode: 'git_diff',
    businessBaseBranch: 'stable/l46-business-base',
    businessBaseCommit: 'dbb25ca2cf2e6d91af69a24454120f006a9422b0',
  },
  L48: {
    sourceMode: 'git_diff',
    businessBaseBranch: 'stable/l47-business-base',
    businessBaseCommit: 'a23401df53cfae1cd41fd47f94c59f3f974d1e60',
  },
};

export const GLOBAL_STATIC_VERIFIERS = [
  'scripts/verify-prisma-sql-composition-local.ts',
  'scripts/verify-report-source-resolver-local.ts',
  'scripts/verify-report-markdown-local.ts',
] as const;

const historicalStages = [
  ['L24', 'Miniapp Cart', 'scripts/verify-l24-miniapp-cart-local.ts'],
  ['L25', 'Order Confirm Quantity Guard', 'scripts/verify-l25-order-confirm-quantity-guard-local.ts'],
  ['L26', 'Group Buy Success Rule', 'scripts/verify-l26-group-buy-success-rule-local.ts'],
  ['L27', 'Group Buy Expiry Manual Refund', 'scripts/verify-l27-group-buy-expiry-manual-refund-local.ts'],
  ['L28', 'Refund Ledger Finance Check', 'scripts/verify-l28-refund-ledger-finance-check-local.ts'],
  ['L29', 'Admin Refund Ledger Page', 'scripts/verify-l29-admin-refund-ledger-page-local.ts'],
  ['L30', 'Refund Payment Risk Idempotency', 'scripts/verify-l30-refund-payment-risk-idempotency-local.ts'],
  ['L31', 'Admin Access Control Baseline', 'scripts/verify-l31-admin-access-control-baseline-local.ts'],
  ['L32', 'Clerk Pickup Workbench', 'scripts/verify-l32-clerk-pickup-workbench-local.ts'],
  ['L33', 'Pickup Navigation Delivery Reservation', 'scripts/verify-l33-pickup-navigation-delivery-reservation-local.ts'],
  ['L34', 'Admin Data Scope Baseline', 'scripts/verify-l34-admin-data-scope-baseline-local.ts'],
  ['L35', 'User Delivery Option Baseline', 'scripts/verify-l35-user-delivery-option-baseline-local.ts'],
  ['L36', 'Delivery Fee Window Range Baseline', 'scripts/verify-l36-delivery-fee-window-range-baseline-local.ts'],
  ['L37', 'Delivery Rule Config Baseline', 'scripts/verify-l37-delivery-rule-config-baseline-local.ts'],
  ['L38', 'Delivery Fee Order Amount Baseline', 'scripts/verify-l38-delivery-fee-order-amount-baseline-local.ts'],
  ['L39', 'Delivery Refund Finance Baseline', 'scripts/verify-l39-delivery-refund-finance-baseline-local.ts'],
  ['L40', 'Admin Order After-sale Workbench', 'scripts/verify-l40-admin-order-after-sale-workbench-local.ts'],
  ['L41', 'Inventory Deduct Restore', 'scripts/verify-l41-inventory-deduct-restore-local.ts'],
  ['L42', 'Failed Group Buy Manual Closure', 'scripts/verify-l42-failed-group-buy-manual-closure-local.ts'],
  ['L43', 'Reward Ledger T3 Refund Deduct', 'scripts/verify-l43-reward-ledger-t3-refund-deduct-local.ts'],
  ['L44', 'Manual Withdrawal Review', 'scripts/verify-l44-manual-withdrawal-review-local.ts'],
  ['L45', 'Manual Tax Review Export', 'scripts/verify-l45-manual-tax-review-export-local.ts'],
] as const;

const stageDefinitions: StageDefinition[] = [
  ...historicalStages.map(([id, title, verifier]) => ({
    id,
    number: Number(id.slice(1)),
    title,
    verifier,
  })),
  {
    id: 'L46',
    number: 46,
    title: 'Admin Business Dashboard V2',
    verifier: 'scripts/verify-l46-admin-business-dashboard-v2-local.ts',
    additionalVerifiers: ['scripts/verify-l46-tax-record-db-scope-local.ts'],
  },
  {
    id: 'L47',
    number: 47,
    title: 'Miniapp Profile V2 and Leader Center',
    verifier: 'scripts/verify-l47-miniapp-profile-leader-center-local.ts',
    additionalVerifiers: [
      'scripts/run-l47-center-docker-api-e2e-local.ts',
      'scripts/verify-l47-report-routing-local.ts',
    ],
    runtimeMarkers: L47_RUNTIME_MARKERS,
  },
  {
    id: 'L48',
    number: 48,
    title: 'Security and Privacy Hardening',
    verifier: 'scripts/verify-l48-security-privacy-hardening-local.ts',
    additionalVerifiers: [
      'scripts/run-l48-security-privacy-docker-e2e-local.ts',
      'scripts/verify-l48-report-routing-local.ts',
    ],
    runtimeMarkers: L48_RUNTIME_MARKERS,
  },
];

export const STAGE_REGISTRY = stageDefinitions.map((stage) => ({
  ...stage,
  reportContract: REPORT_CONTRACTS[stage.id],
})) as readonly StageDefinition[];

export function getStageDefinition(id: string) {
  return STAGE_REGISTRY.find((stage) => stage.id === id.toUpperCase());
}

export function latestRegisteredStage() {
  return STAGE_REGISTRY.at(-1)!;
}

export function registeredStageIds() {
  return STAGE_REGISTRY.map((stage) => stage.id);
}

export function getStageChain(id: string) {
  const stage = getStageDefinition(id);
  if (!stage) throw new Error(`Unknown stage: ${id}`);
  return STAGE_REGISTRY
    .filter((item) => item.number <= stage.number)
    .map((item) => item.id)
    .reverse();
}

export function assertStageRegistryFiles() {
  for (const stage of STAGE_REGISTRY) {
    for (const file of [stage.verifier, ...(stage.additionalVerifiers ?? [])]) {
      if (!existsSync(file)) throw new Error(`Missing verifier: ${file}`);
    }
  }
}
