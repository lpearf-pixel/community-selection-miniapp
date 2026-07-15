export type L45HttpStatusScenario = {
  type: 'http_status';
  expected_status: number;
  marker: string;
};

export type L45SingleRequestScenario = {
  type: 'single_request';
  expected_status: number;
  idempotent?: boolean;
  marker: string;
};

export type L45ConcurrentScenario = {
  type: 'concurrent';
  fulfilled_count: number;
  applied_count: number;
  idempotent_count: number;
  marker: string;
};

export type L45ApiContractEntry = {
  key: 'tax_record_list' | 'tax_record_detail' | 'tax_record_export' | 'tax_review' | 'mark_paid';
  purpose: string;
  method: 'GET' | 'POST';
  path: string;
  permission: string;
  data_scope: string;
  success_status: number;
  error_statuses: number[];
  runtime_marker: string;
  runtime_markers_required: string[];
  scenarios: Array<L45HttpStatusScenario | L45SingleRequestScenario | L45ConcurrentScenario>;
};

export const L45_API_CONTRACT: Record<L45ApiContractEntry['key'], L45ApiContractEntry> = {
  tax_record_list: {
    key: 'tax_record_list',
    purpose: '税务人工 Review 分页列表',
    method: 'GET',
    path: '/api/admin/tax-records',
    permission: 'finance.view + data scope',
    data_scope: 'server session scope or non-production header_mock scope',
    success_status: 200,
    error_statuses: [400, 401, 403],
    runtime_marker: 'l45_tax_list_scope_success=true',
    runtime_markers_required: ['l45_tax_list_scope_success=true', 'l45_admin_scope_runtime=true'],
    scenarios: [{ type: 'http_status', expected_status: 200, marker: 'l45_tax_list_scope_success=true' }]
  },
  tax_record_detail: {
    key: 'tax_record_detail',
    purpose: '税务人工 Review 详情',
    method: 'GET',
    path: '/api/admin/tax-records/:id',
    permission: 'finance.view + data scope',
    data_scope: 'server session scope or non-production header_mock scope',
    success_status: 200,
    error_statuses: [401, 403, 404],
    runtime_marker: 'l45_tax_detail_success=true',
    runtime_markers_required: ['l45_tax_detail_success=true'],
    scenarios: [{ type: 'http_status', expected_status: 200, marker: 'l45_tax_detail_success=true' }]
  },
  tax_record_export: {
    key: 'tax_record_export',
    purpose: '内部人工核对 CSV 导出',
    method: 'GET',
    path: '/api/admin/tax-records/export.csv',
    permission: 'finance.export + data scope',
    data_scope: 'server session scope or non-production header_mock scope',
    success_status: 200,
    error_statuses: [400, 401, 403, 422],
    runtime_marker: 'l45_tax_export_success=true',
    runtime_markers_required: ['l45_tax_export_success=true', 'l45_tax_export_over_limit_http_422=true', 'l45_csv_formula_safe=true'],
    scenarios: [
      { type: 'http_status', expected_status: 200, marker: 'l45_tax_export_success=true' },
      { type: 'http_status', expected_status: 422, marker: 'l45_tax_export_over_limit_http_422=true' }
    ]
  },
  tax_review: {
    key: 'tax_review',
    purpose: '人工税务 Review',
    method: 'POST',
    path: '/api/admin/withdrawals/:id/tax-review',
    permission: 'withdrawal.manage + data scope',
    data_scope: 'server session scope or non-production header_mock scope',
    success_status: 200,
    error_statuses: [400, 401, 403, 404, 409],
    runtime_marker: 'l45_tax_review_success=true',
    runtime_markers_required: ['l45_tax_review_success=true', 'l45_tax_review_stale_version_409=true', 'l45_tax_review_terminal_replay=true', 'l45_tax_review_new_key_terminal_409=true', 'l45_tax_review_invalid_same_key_400=true', 'l45_tax_review_valid_same_key_409=true', 'l45_tax_review_concurrent_counts=true'],
    scenarios: [
      { type: 'single_request', expected_status: 200, marker: 'l45_tax_review_success=true' },
      { type: 'http_status', expected_status: 200, marker: 'l45_tax_review_terminal_replay=true' },
      { type: 'http_status', expected_status: 409, marker: 'l45_tax_review_new_key_terminal_409=true' },
      { type: 'http_status', expected_status: 409, marker: 'l45_tax_review_stale_version_409=true' },
      { type: 'http_status', expected_status: 400, marker: 'l45_tax_review_invalid_same_key_400=true' },
      { type: 'http_status', expected_status: 409, marker: 'l45_tax_review_valid_same_key_409=true' },
      { type: 'concurrent', fulfilled_count: 2, applied_count: 1, idempotent_count: 1, marker: 'l45_tax_review_concurrent_counts=true' }
    ]
  },
  mark_paid: {
    key: 'mark_paid',
    purpose: '人工标记提现已处理',
    method: 'POST',
    path: '/api/admin/withdrawals/:id/mark-paid',
    permission: 'withdrawal.manage + data scope',
    data_scope: 'server session scope or non-production header_mock scope',
    success_status: 200,
    error_statuses: [400, 401, 403, 409],
    runtime_marker: 'l45_mark_paid_success=true',
    runtime_markers_required: ['l45_mark_paid_success=true', 'l45_mark_paid_conflict_409=true', 'l45_mark_paid_rollback_verified=true'],
    scenarios: [
      { type: 'single_request', expected_status: 200, marker: 'l45_mark_paid_success=true' },
      { type: 'http_status', expected_status: 409, marker: 'l45_mark_paid_conflict_409=true' }
    ]
  }
};

export const L45_API_CONTRACT_LIST = Object.values(L45_API_CONTRACT);

export function l45TaxReviewConcurrentScenario() {
  const scenarios = L45_API_CONTRACT.tax_review.scenarios.filter((item) => item.type === 'concurrent');
  if (scenarios.length !== 1) throw new Error(`L45 tax_review contract must contain exactly one concurrent scenario; actual=${scenarios.length}`);
  const scenario = scenarios[0];
  if (scenario.type !== 'concurrent') throw new Error('L45 tax_review concurrent scenario type mismatch');
  for (const [name, value] of Object.entries({ fulfilled_count: scenario.fulfilled_count, applied_count: scenario.applied_count, idempotent_count: scenario.idempotent_count })) {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`L45 tax_review concurrent ${name} must be a positive integer`);
  }
  if (scenario.fulfilled_count !== scenario.applied_count + scenario.idempotent_count) throw new Error('L45 tax_review concurrent counts must satisfy fulfilled_count === applied_count + idempotent_count');
  return scenario;
}

export function l45ConcurrentRuntimeMarkers() {
  const scenario = l45TaxReviewConcurrentScenario();
  return [
    `l45_concurrent_fulfilled_count=${scenario.fulfilled_count}`,
    `l45_concurrent_applied_count=${scenario.applied_count}`,
    `l45_concurrent_idempotent_count=${scenario.idempotent_count}`
  ];
}
