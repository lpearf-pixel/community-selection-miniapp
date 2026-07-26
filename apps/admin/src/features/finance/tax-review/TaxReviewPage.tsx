import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Form, Space, Spin, Typography } from 'antd';
import { featureErrorMessage } from '../../../shared/state/feature-resource';
import { useFeatureResourceLoader } from '../../../shared/state/use-feature-resource-loader';
import {
  downloadTaxReviewCsv,
  getTaxReviewDetail,
  listTaxReviews,
  submitTaxReview,
} from './api';
import { TaxReviewDrawer } from './TaxReviewDrawer';
import { TaxReviewFilters } from './TaxReviewFilters';
import { TaxReviewTable } from './TaxReviewTable';
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
      listTaxReviews({ ...filters, page, page_size: 20 }, undefined, signal),
    [filters, page, queryVersion],
  );
  const { state, retry } = useFeatureResourceLoader(load, props.refreshVersion);

  useEffect(() => {
    return () => {
      detailRequestRef.current?.abort();
    };
  }, []);

  const openDetail = async (row: TaxReviewRow) => {
    detailRequestRef.current?.abort();
    const controller = new AbortController();
    detailRequestRef.current = controller;
    setActionError('');
    try {
      const fetched = await getTaxReviewDetail(row.tax_record_id, undefined, controller.signal);
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
      await submitTaxReview(detail.withdrawal_id, detail.version, values);
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
        <TaxReviewFilters
          exporting={exporting}
          onFiltersChange={(patch) =>
            setDraftFilters((current) => ({ ...current, ...patch }))
          }
          onQuery={() => {
            setFilters(draftFilters);
            setPage(1);
            setQueryVersion((version) => version + 1);
          }}
          onExport={() => void exportCsv()}
        />
        <TaxReviewTable
          data={state.data}
          refreshing={state.status === 'refreshing'}
          onPageChange={setPage}
          onOpenDetail={(row) => void openDetail(row)}
        />
        <TaxReviewDrawer
          detail={detail}
          form={form}
          submitting={submitting}
          onClose={() => setDetail(null)}
          onSubmit={() => void submit()}
        />
      </Card>
    </Space>
  );
}
