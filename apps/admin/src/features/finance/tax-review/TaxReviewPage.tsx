import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd';
import { formatYuan } from '@community-selection/shared';
import { featureErrorMessage } from '../../../shared/state/feature-resource';
import { useFeatureResourceLoader } from '../../../shared/state/use-feature-resource-loader';
import {
  downloadTaxReviewCsv,
  getTaxReviewDetail,
  listTaxReviews,
  submitTaxReview,
} from './api';
import type {
  TaxReviewDetail,
  TaxReviewPayload,
  TaxReviewQuery,
  TaxReviewRow,
} from './types';

const notice = '仅供内部人工核对，不构成税务申报结果。';

export type TaxReviewPageProps = {
  refreshVersion: number;
  onMessage: (message: string) => void;
  onMutationCommitted: () => void;
};

export function TaxReviewPage(props: TaxReviewPageProps) {
  const [page, setPage] = useState(1);
  const [draftFilters, setDraftFilters] = useState<TaxReviewQuery>({});
  const [filters, setFilters] = useState<TaxReviewQuery>({});
  const [queryVersion, setQueryVersion] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [detail, setDetail] = useState<TaxReviewDetail | null>(null);
  const [form] = Form.useForm<TaxReviewPayload>();
  const detailRequestRef = useRef<AbortController | null>(null);

  const load = useCallback(
    (signal: AbortSignal) =>
      listTaxReviews(
        { ...filters, page, page_size: 20 },
        undefined,
        signal,
      ),
    [filters, page, queryVersion],
  );
  const { state, retry } = useFeatureResourceLoader(
    load,
    props.refreshVersion,
  );

  useEffect(
    () => () => {
      detailRequestRef.current?.abort();
    },
    [],
  );

  const openDetail = async (row: TaxReviewRow) => {
    detailRequestRef.current?.abort();
    const controller = new AbortController();
    detailRequestRef.current = controller;
    setActionError('');
    try {
      const fetched = await getTaxReviewDetail(
        row.tax_record_id,
        undefined,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setDetail(fetched);
      form.setFieldsValue({
        tax_mode:
          fetched.tax_mode === 'pending_review' ? 'none' : fetched.tax_mode,
        taxable_amount_cents: fetched.taxable_amount_cents,
        tax_amount_cents: fetched.tax_amount_cents,
        tax_rate_basis: fetched.tax_rate_basis ?? undefined,
        invoice_status: fetched.invoice_status,
        tax_remark: fetched.tax_remark ?? undefined,
        client_request_id: `tax-review-${Date.now()}`,
        expected_updated_at: fetched.updated_at,
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        setActionError(featureErrorMessage(error));
      }
    } finally {
      if (detailRequestRef.current === controller) {
        detailRequestRef.current = null;
      }
    }
  };

  const submit = async () => {
    if (!detail || submitting) return;
    setSubmitting(true);
    setActionError('');
    try {
      const values = await form.validateFields();
      await submitTaxReview(detail.withdrawal_id, values);
      props.onMessage(
        '人工税务 Review 已保存，系统不会自动报税、不会连接外部税务平台、不会自动发起打款。',
      );
      setDetail(null);
      props.onMutationCommitted();
    } catch (error) {
      setActionError(featureErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    setActionError('');
    try {
      const filename = await downloadTaxReviewCsv({
        ...filters,
        page,
        page_size: 20,
      });
      props.onMessage(`已导出 ${filename}`);
    } catch (error) {
      setActionError(featureErrorMessage(error));
    } finally {
      setExporting(false);
    }
  };

  const errorAlert = state.error ? (
    <Alert
      type="error"
      showIcon
      message="税务人工 Review 加载失败"
      description={state.error}
      action={
        <Button size="small" onClick={retry}>
          重试
        </Button>
      }
    />
  ) : null;

  if (state.data === null) {
    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {errorAlert}
        {state.status !== 'error' ? (
          <Spin tip="正在加载税务人工 Review" />
        ) : null}
      </Space>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {errorAlert}
      {actionError ? (
        <Alert
          type="error"
          showIcon
          message="税务人工 Review 操作失败"
          description={actionError}
          closable
          onClose={() => setActionError('')}
        />
      ) : null}
      {state.status === 'refreshing' ? (
        <Typography.Text type="secondary">
          正在刷新税务人工 Review…
        </Typography.Text>
      ) : null}
      <Card title="税务人工 Review 工作台">
        <Alert
          type="warning"
          showIcon
          message="系统不会自动报税。系统不会连接外部税务平台。系统不会自动发起打款。仅供内部人工核对。"
          description={notice}
        />
        <Space wrap style={{ margin: '16px 0' }}>
          <Input
            placeholder="Leader／提现申请编号关键词"
            onChange={(event) =>
              setDraftFilters((current) => ({
                ...current,
                keyword: event.target.value,
              }))
            }
          />
          <Select
            allowClear
            placeholder="税务状态"
            style={{ width: 150 }}
            onChange={(value) =>
              setDraftFilters((current) => ({
                ...current,
                tax_status: value ?? '',
              }))
            }
            options={['pending', 'completed', 'calculated', 'pending_invoice'].map(
              (value) => ({ value, label: value }),
            )}
          />
          <Select
            allowClear
            placeholder="税务模式"
            style={{ width: 150 }}
            onChange={(value) =>
              setDraftFilters((current) => ({
                ...current,
                tax_mode: value ?? '',
              }))
            }
            options={['pending_review', 'none', 'withheld', 'invoice'].map(
              (value) => ({ value, label: value }),
            )}
          />
          <Select
            allowClear
            placeholder="发票状态"
            style={{ width: 150 }}
            onChange={(value) =>
              setDraftFilters((current) => ({
                ...current,
                invoice_status: value ?? '',
              }))
            }
            options={['not_required', 'pending', 'verified', 'rejected'].map(
              (value) => ({ value, label: value }),
            )}
          />
          <DatePicker.RangePicker
            onChange={(_, values) =>
              setDraftFilters((current) => ({
                ...current,
                from: values[0],
                to: values[1],
              }))
            }
          />
          <Button
            type="primary"
            onClick={() => {
              setFilters(draftFilters);
              setPage(1);
              setQueryVersion((version) => version + 1);
            }}
          >
            查询
          </Button>
          <Button loading={exporting} onClick={() => void exportCsv()}>
            导出内部核对 CSV
          </Button>
        </Space>
        <Table
          rowKey="tax_record_id"
          loading={state.status === 'refreshing'}
          dataSource={state.data.items}
          pagination={{
            current: state.data.page,
            total: state.data.total,
            pageSize: state.data.page_size,
            onChange: setPage,
          }}
          columns={[
            { title: '申请编号', dataIndex: 'client_request_id' },
            {
              title: 'Leader',
              render: (_: unknown, row: TaxReviewRow) =>
                `${row.leader_nickname} ${row.leader_phone_masked ?? ''}`,
            },
            {
              title: '社区',
              render: (_: unknown, row: TaxReviewRow) =>
                row.community_names.join('、'),
            },
            {
              title: '总金额',
              render: (_: unknown, row: TaxReviewRow) =>
                `¥${formatYuan(row.gross_amount_cents)}`,
            },
            {
              title: '应税/税额/应付',
              render: (_: unknown, row: TaxReviewRow) =>
                `${row.taxable_amount_cents} / ${row.tax_amount_cents} / ${row.payable_amount_cents} 分`,
            },
            {
              title: '税务',
              render: (_: unknown, row: TaxReviewRow) => (
                <Space>
                  <Tag>{row.tax_mode}</Tag>
                  <Tag>{row.tax_status}</Tag>
                  <Tag>{row.invoice_status}</Tag>
                </Space>
              ),
            },
            {
              title: '操作',
              render: (_: unknown, row: TaxReviewRow) => (
                <Button onClick={() => void openDetail(row)}>
                  详情 / 人工 Review
                </Button>
              ),
            },
          ]}
        />
        <Drawer
          width={720}
          open={detail !== null}
          onClose={() => setDetail(null)}
          title="税务 Review 详情"
        >
          {detail ? (
            <>
              <Alert
                type="info"
                message="仅供内部人工核对，不构成税务申报结果。系统不会自动报税，不会连接外部税务平台，不会自动发起打款。"
              />
              <Typography.Paragraph>
                关联订单/商品：
                {detail.commissions
                  .map(
                    (commission) =>
                      `${commission.order_no}/${commission.product_name}/${commission.community_name}/${commission.reward_amount_cents}分`,
                  )
                  .join('；')}
              </Typography.Paragraph>
              <Form form={form} layout="vertical">
                <Form.Item
                  name="tax_mode"
                  label="税务模式"
                  rules={[{ required: true }]}
                >
                  <Select
                    options={['none', 'withheld', 'invoice'].map(
                      (value) => ({ value, label: value }),
                    )}
                  />
                </Form.Item>
                <Form.Item
                  name="taxable_amount_cents"
                  label="应税金额（分）"
                  rules={[{ required: true }]}
                >
                  <InputNumber min={0} precision={0} />
                </Form.Item>
                <Form.Item
                  name="tax_amount_cents"
                  label="人工确认税额（分）"
                  rules={[{ required: true }]}
                >
                  <InputNumber min={0} precision={0} />
                </Form.Item>
                <Form.Item name="tax_rate_basis" label="人工依据">
                  <Input />
                </Form.Item>
                <Form.Item name="invoice_status" label="发票状态">
                  <Select
                    options={[
                      'not_required',
                      'pending',
                      'verified',
                      'rejected',
                    ].map((value) => ({ value, label: value }))}
                  />
                </Form.Item>
                <Form.Item name="tax_remark" label="备注">
                  <Input.TextArea />
                </Form.Item>
                <Form.Item
                  name="client_request_id"
                  label="幂等键"
                  rules={[{ required: true }, { max: 80 }]}
                >
                  <Input />
                </Form.Item>
                <Form.Item name="expected_updated_at" hidden>
                  <Input />
                </Form.Item>
              </Form>
              <Button
                type="primary"
                loading={submitting}
                disabled={submitting}
                onClick={() => void submit()}
              >
                保存人工 Review
              </Button>
            </>
          ) : null}
        </Drawer>
      </Card>
    </Space>
  );
}
