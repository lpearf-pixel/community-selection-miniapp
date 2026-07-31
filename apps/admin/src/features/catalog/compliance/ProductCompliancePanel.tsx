import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Input,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  accessComplianceEvidence,
  loadProductCompliance,
  reviewProductCompliance,
  submitProductCompliance,
  type ComplianceBatchEvidenceSummary,
  type ComplianceEvidenceType,
  type ComplianceQualificationSummary,
  type MaskedSummary,
  type ProductComplianceWorkbenchState,
} from './api';

export type { ProductComplianceWorkbenchState } from './api';

const SUBJECT_LABEL: Record<string, string> = {
  company: '企业',
  cooperative: '农民专业合作社',
  individual_business: '个体工商户',
  natural_person_producer: '自然人生产者',
  market_stall: '批发市场档口',
  collector: '收购商',
  temporary_source: '临时来源',
};

const MASKED_SUMMARY_FIELDS: Record<string, ReadonlySet<string>> = {
  business_license: new Set(['holder_name_masked', 'license_no_masked']),
  food_business_license: new Set([
    'holder_name_masked',
    'license_no_masked',
  ]),
  agricultural_producer_identity: new Set([
    'producer_name_masked',
    'identity_no_masked',
  ]),
  origin_certificate: new Set([
    'certificate_no_masked',
    'origin_masked',
    'issuer_masked',
  ]),
  quality_certificate: new Set([
    'certificate_no_masked',
    'issuer_masked',
  ]),
  market_stall_registration: new Set([
    'market_name_masked',
    'stall_no_masked',
  ]),
  purchase_agreement: new Set([
    'agreement_no_masked',
    'counterparty_masked',
  ]),
  batch_proof: new Set([
    'batch_no_masked',
    'origin_masked',
    'producer_name_masked',
  ]),
  purchase_voucher: new Set([
    'voucher_no_masked',
    'counterparty_masked',
    'purchase_date_masked',
  ]),
  inspection_report: new Set(['report_no_masked', 'issuer_masked']),
};
const PURCHASE_VOUCHER_TYPES = new Set([
  'invoice',
  'receipt',
  'purchase_agreement',
  'farmer_purchase_record',
  'market_ticket',
]);

export function safeMaskedSummary(
  evidenceType: string,
  summary: MaskedSummary,
) {
  const allowed = MASKED_SUMMARY_FIELDS[evidenceType] ?? new Set<string>();
  const entries = Object.entries(summary)
    .filter(
      ([key, value]) =>
        allowed.has(key) &&
        value.length <= 200 &&
        /[*•]/.test(value) &&
        value.replace(/[*•\s-]/g, '').length <= 6 &&
        !/(?:https?:\/\/|data:)/i.test(value) &&
        !/\d{7,}/.test(value),
    )
    .sort(([left], [right]) => left.localeCompare(right));
  const voucherType = summary.purchase_voucher_type;
  if (
    evidenceType === 'purchase_traceability' &&
    PURCHASE_VOUCHER_TYPES.has(voucherType)
  ) {
    entries.push(['purchase_voucher_type', voucherType]);
  }
  return entries;
}

function maskedSummaryText(evidenceType: string, summary: MaskedSummary) {
  const entries = safeMaskedSummary(evidenceType, summary);
  return entries.length === 0
    ? '无可展示摘要'
    : entries.map(([key, value]) => `${key}: ${value}`).join('；');
}

type WorkbenchViewProps = {
  state: ProductComplianceWorkbenchState;
  busy: boolean;
  actionError?: string;
  onSubmit: () => void;
  onReview: (decision: 'approve' | 'reject', reviewNote: string) => void;
  onAccessEvidence: (
    evidenceType: ComplianceEvidenceType,
    evidenceId: string,
  ) => void;
};

export function ProductComplianceWorkbenchView(props: WorkbenchViewProps) {
  const [reviewNote, setReviewNote] = useState('');
  const sessionKey = reviewSessionKey(props.state);
  useEffect(() => setReviewNote(''), [sessionKey]);
  const pendingReview = props.state.latest_review?.status === 'submitted';
  const reviewNoteReady = reviewNote.trim().length > 0;
  const supplier = props.state.supplier;

  const review = (decision: 'approve' | 'reject') => {
    if (!reviewNoteReady) return;
    if (!window.confirm(`确认${decision === 'approve' ? '通过' : '驳回'}本次审核？`)) {
      return;
    }
    props.onReview(decision, reviewNote.trim());
  };

  return (
    <Card title="商品合规审核">
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {props.actionError ? (
          <Alert type="error" showIcon message={props.actionError} />
        ) : null}
        {props.state.reason_codes.length > 0 ? (
          <Alert
            type="warning"
            showIcon
            message="当前合规状态未通过"
            description={props.state.reason_codes.join('、')}
          />
        ) : (
          <Alert type="success" showIcon message="当前合规事实完整" />
        )}
        <Descriptions size="small" column={2}>
          <Descriptions.Item label="当前指纹">
            <Typography.Text code copyable>
              {props.state.current_fingerprint}
            </Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="最新审核">
            {props.state.latest_review?.status ?? '尚未提交'}
          </Descriptions.Item>
          <Descriptions.Item label="动态有效">
            {props.state.latest_review?.effective_valid ? '有效' : '无效'}
          </Descriptions.Item>
          <Descriptions.Item label="供应商主体">
            {supplier?.subject_type
              ? SUBJECT_LABEL[supplier.subject_type] ?? supplier.subject_type
              : '未配置'}
          </Descriptions.Item>
          <Descriptions.Item label="来源档案">
            {supplier?.source_complete ? '完整' : '不完整'}
          </Descriptions.Item>
          <Descriptions.Item label="供应商状态">
            {supplier?.status ?? '未配置'}
          </Descriptions.Item>
        </Descriptions>

        <Typography.Title level={5}>供应商资质</Typography.Title>
        <Table<ComplianceQualificationSummary>
          size="small"
          pagination={false}
          rowKey="id"
          dataSource={supplier?.qualifications ?? []}
          columns={[
            { title: '类型', dataIndex: 'qualification_type' },
            { title: '版本', dataIndex: 'version' },
            {
              title: '状态',
              dataIndex: 'status',
              render: (value: string) => <Tag>{value}</Tag>,
            },
            {
              title: '到期日',
              dataIndex: 'expires_at',
              render: (value: string | null) => value?.slice(0, 10) ?? '长期',
            },
            {
              title: '脱敏摘要',
              dataIndex: 'masked_summary',
              render: (
                value: MaskedSummary,
                row: { qualification_type: string },
              ) => maskedSummaryText(row.qualification_type, value),
            },
            {
              title: '证据',
              render: (_: unknown, row: ComplianceQualificationSummary) => (
                <Button
                  size="small"
                  onClick={() =>
                    props.onAccessEvidence('supplier_qualification', row.id)
                  }
                >
                  申请查看
                </Button>
              ),
            },
          ]}
        />

        <Typography.Title level={5}>批次证据</Typography.Title>
        <Table<ComplianceBatchEvidenceSummary>
          size="small"
          pagination={false}
          rowKey="id"
          dataSource={props.state.batch_evidence}
          columns={[
            { title: '类型', dataIndex: 'evidence_type' },
            { title: '状态', dataIndex: 'status' },
            {
              title: '脱敏摘要',
              dataIndex: 'masked_summary',
              render: (
                value: MaskedSummary,
                row: { evidence_type: string },
              ) => maskedSummaryText(row.evidence_type, value),
            },
            {
              title: '证据',
              render: (_: unknown, row: ComplianceBatchEvidenceSummary) => (
                <Button
                  size="small"
                  onClick={() =>
                    props.onAccessEvidence('product_batch_evidence', row.id)
                  }
                >
                  申请查看
                </Button>
              ),
            },
          ]}
        />

        <Space direction="vertical" style={{ width: '100%' }}>
          <Button
            type="primary"
            loading={props.busy}
            disabled={!props.state.eligible_for_submission}
            onClick={() => {
              if (window.confirm('确认按当前合规事实提交审核？')) {
                props.onSubmit();
              }
            }}
          >
            提交审核
          </Button>
          <Input.TextArea
            aria-label="审核说明"
            placeholder="审核说明（必填）"
            maxLength={500}
            value={reviewNote}
            onChange={(event) => setReviewNote(event.target.value)}
          />
          <Space>
            <Button
              loading={props.busy}
              disabled={!pendingReview || !reviewNoteReady}
              onClick={() => review('approve')}
            >
              通过
            </Button>
            <Button
              danger
              loading={props.busy}
              disabled={!pendingReview || !reviewNoteReady}
              onClick={() => review('reject')}
            >
              驳回
            </Button>
          </Space>
        </Space>
      </Space>
    </Card>
  );
}

export function isCurrentComplianceRequest(
  currentProductId: string,
  requestedProductId: string,
) {
  return currentProductId === requestedProductId;
}

export function reviewSessionKey(state: ProductComplianceWorkbenchState) {
  return `${state.product_id}:${state.latest_review?.id ?? 'none'}`;
}

export function ProductCompliancePanel(props: {
  productId: string;
  onMessage?: (message: string) => void;
}) {
  const [state, setState] = useState<ProductComplianceWorkbenchState | null>(
    null,
  );
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const currentProductId = useRef(props.productId);

  const reload = async (productId: string, signal?: AbortSignal) => {
    const next = await loadProductCompliance(
      productId,
      undefined,
      signal,
    );
    if (isCurrentComplianceRequest(currentProductId.current, productId)) {
      setState(next);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    currentProductId.current = props.productId;
    setState(null);
    setLoadError('');
    setActionError('');
    setBusy(false);
    void reload(props.productId, controller.signal).catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        setLoadError(
          cause instanceof Error ? cause.message : '商品合规状态加载失败',
        );
      }
    });
    return () => controller.abort();
  }, [props.productId]);

  const mutate = async (
    productId: string,
    action: () => Promise<unknown>,
    message: string,
  ) => {
    setBusy(true);
    setActionError('');
    try {
      await action();
      if (isCurrentComplianceRequest(currentProductId.current, productId)) {
        await reload(productId);
        props.onMessage?.(message);
      }
    } catch (cause) {
      if (isCurrentComplianceRequest(currentProductId.current, productId)) {
        setActionError(
          cause instanceof Error ? cause.message : '商品合规操作失败',
        );
      }
    } finally {
      if (isCurrentComplianceRequest(currentProductId.current, productId)) {
        setBusy(false);
      }
    }
  };

  if (loadError) return <Alert type="error" showIcon message={loadError} />;
  if (!state) return <Spin tip="正在加载商品合规状态" />;

  return (
    <ProductComplianceWorkbenchView
      key={reviewSessionKey(state)}
      state={state}
      busy={busy}
      actionError={actionError}
      onSubmit={() =>
        void mutate(
          state.product_id,
          () =>
            submitProductCompliance(
              state.product_id,
              state.current_fingerprint,
              crypto.randomUUID(),
            ),
          '商品合规材料已提交，仍需单独审核',
        )
      }
      onReview={(decision, note) => {
        if (!state.latest_review) return;
        void mutate(
          state.product_id,
          () =>
            reviewProductCompliance(
              state.latest_review!.id,
              decision,
              note,
              crypto.randomUUID(),
            ),
          decision === 'approve' ? '商品合规审核已通过' : '商品合规审核已驳回',
        );
      }}
      onAccessEvidence={(evidenceType, evidenceId) => {
        const purpose = window.prompt('请输入本次查看证据的用途');
        if (!purpose?.trim()) return;
        void mutate(
          state.product_id,
          () =>
            accessComplianceEvidence(
              evidenceType,
              evidenceId,
              purpose.trim(),
            ),
          '证据访问申请已记录',
        );
      }}
    />
  );
}
