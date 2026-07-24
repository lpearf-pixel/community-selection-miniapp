import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Typography,
} from 'antd';
import type { FormInstance } from 'antd';
import type { TaxReviewDetail, TaxReviewPayload } from './types';

export type TaxReviewDrawerProps = {
  detail: TaxReviewDetail | null;
  form: FormInstance<TaxReviewPayload>;
  submitting: boolean;
  onClose: () => void;
  onSubmit: () => void;
};

export function TaxReviewDrawer(props: TaxReviewDrawerProps) {
  return (
    <Drawer
      width={720}
      open={props.detail !== null}
      onClose={props.onClose}
      title="税务 Review 详情"
    >
      {props.detail ? (
        <>
          <Alert
            type="info"
            message="仅供内部人工核对，不构成税务申报结果。系统不会自动报税，不会连接外部税务平台，不会自动发起打款。"
          />
          <Typography.Paragraph>
            关联订单/商品：
            {props.detail.commissions
              .map(
                (commission) =>
                  `${commission.order_no}/${commission.product_name}/${commission.community_name}/${commission.reward_amount_cents}分`,
              )
              .join('；')}
          </Typography.Paragraph>
          <Form form={props.form} layout="vertical">
            <Form.Item
              name="tax_mode"
              label="税务模式"
              rules={[{ required: true }]}
            >
              <Select
                options={['none', 'withheld', 'invoice'].map((value) => ({
                  value,
                  label: value,
                }))}
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
            loading={props.submitting}
            disabled={props.submitting}
            onClick={props.onSubmit}
          >
            保存人工 Review
          </Button>
        </>
      ) : null}
    </Drawer>
  );
}
