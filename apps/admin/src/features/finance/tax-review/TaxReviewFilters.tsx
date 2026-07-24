import { Button, DatePicker, Input, Select, Space } from 'antd';
import type { TaxReviewQuery } from './types';

const taxStatusOptions = [
  'pending',
  'completed',
  'calculated',
  'pending_invoice',
].map((value) => ({ value, label: value }));
const taxModeOptions = ['pending_review', 'none', 'withheld', 'invoice'].map(
  (value) => ({ value, label: value }),
);
const invoiceStatusOptions = [
  'not_required',
  'pending',
  'verified',
  'rejected',
].map((value) => ({ value, label: value }));

export type TaxReviewFiltersProps = {
  exporting: boolean;
  onFiltersChange: (patch: Partial<TaxReviewQuery>) => void;
  onQuery: () => void;
  onExport: () => void;
};

export function TaxReviewFilters(props: TaxReviewFiltersProps) {
  return (
    <Space wrap style={{ margin: '16px 0' }}>
      <Input
        placeholder="Leader／提现申请编号关键词"
        onChange={(event) =>
          props.onFiltersChange({ keyword: event.target.value })
        }
      />
      <Select
        allowClear
        placeholder="税务状态"
        style={{ width: 150 }}
        onChange={(value) =>
          props.onFiltersChange({ tax_status: value ?? '' })
        }
        options={taxStatusOptions}
      />
      <Select
        allowClear
        placeholder="税务模式"
        style={{ width: 150 }}
        onChange={(value) =>
          props.onFiltersChange({ tax_mode: value ?? '' })
        }
        options={taxModeOptions}
      />
      <Select
        allowClear
        placeholder="发票状态"
        style={{ width: 150 }}
        onChange={(value) =>
          props.onFiltersChange({ invoice_status: value ?? '' })
        }
        options={invoiceStatusOptions}
      />
      <DatePicker.RangePicker
        onChange={(_, values) =>
          props.onFiltersChange({ from: values[0], to: values[1] })
        }
      />
      <Button type="primary" onClick={props.onQuery}>
        查询
      </Button>
      <Button loading={props.exporting} onClick={props.onExport}>
        导出内部核对 CSV
      </Button>
    </Space>
  );
}
