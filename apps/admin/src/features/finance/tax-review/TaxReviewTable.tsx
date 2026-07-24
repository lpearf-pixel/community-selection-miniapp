import { Button, Space, Table, Tag } from 'antd';
import { formatYuan } from '@community-selection/shared';
import type { TaxReviewList, TaxReviewRow } from './types';

export type TaxReviewTableProps = {
  data: TaxReviewList;
  refreshing: boolean;
  onPageChange: (page: number) => void;
  onOpenDetail: (row: TaxReviewRow) => void;
};

export function TaxReviewTable(props: TaxReviewTableProps) {
  return (
    <Table
      rowKey="tax_record_id"
      loading={props.refreshing}
      dataSource={props.data.items}
      pagination={{
        current: props.data.page,
        total: props.data.total,
        pageSize: props.data.page_size,
        onChange: props.onPageChange,
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
            <Button onClick={() => props.onOpenDetail(row)}>
              详情 / 人工 Review
            </Button>
          ),
        },
      ]}
    />
  );
}
