export const L45_API_CONTRACT = {
  tax_record_list: {
    key: 'tax_record_list',
    purpose: '税务人工 Review 分页列表',
    method: 'GET',
    path: '/api/admin/tax-records',
    permission: 'finance.view + data scope',
    data_scope: 'server session scope or non-production header_mock scope',
    success_status: 200,
    error_statuses: [401, 403],
    runtime_marker: 'l45_tax_list_scope_success=true',
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
    error_statuses: [401, 403, 422],
    runtime_marker: 'l45_tax_export_success=true',
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
    error_statuses: [400, 401, 403, 409],
    runtime_marker: 'l45_tax_review_success=true',
    scenarios: [
      { type: 'single_request', expected_status: 200, marker: 'l45_tax_review_success=true' },
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
    scenarios: [
      { type: 'single_request', expected_status: 200, marker: 'l45_mark_paid_success=true' },
      { type: 'http_status', expected_status: 409, marker: 'l45_mark_paid_conflict_409=true' }
    ]
  }
};

export const L45_API_CONTRACT_LIST = Object.values(L45_API_CONTRACT);
