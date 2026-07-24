import { Button, Card, Table } from 'antd';
import { formatYuan } from '@community-selection/shared';
import type { GroupBuy } from '../shared/types';

export type GroupBuyListCardProps = {
  groupBuys: GroupBuy[];
  onClone: (groupBuy: GroupBuy) => void;
};

export function GroupBuyListCard(props: GroupBuyListCardProps) {
  return (
    <Card title="团购列表">
      <Table
        rowKey="id"
        dataSource={props.groupBuys}
        columns={[
          {
            title: '商品',
            render: (_: unknown, groupBuy: GroupBuy) =>
              groupBuy.product?.name ?? '-',
          },
          {
            title: '社区',
            render: (_: unknown, groupBuy: GroupBuy) =>
              groupBuy.community?.name ?? '-',
          },
          {
            title: '团购价',
            render: (_: unknown, groupBuy: GroupBuy) =>
              `¥${formatYuan(groupBuy.price_cents)}`,
          },
          {
            title: '人数',
            render: (_: unknown, groupBuy: GroupBuy) =>
              `${groupBuy.current_people}/${groupBuy.min_people}`,
          },
          {
            title: '数量',
            render: (_: unknown, groupBuy: GroupBuy) =>
              `${groupBuy.current_quantity}/${groupBuy.min_quantity}`,
          },
          { title: '状态', dataIndex: 'status' },
          {
            title: '截止时间',
            render: (_: unknown, groupBuy: GroupBuy) =>
              new Date(groupBuy.end_time).toLocaleString(),
          },
          {
            title: '操作',
            render: (_: unknown, groupBuy: GroupBuy) => (
              <Button onClick={() => props.onClone(groupBuy)}>
                一键再开团
              </Button>
            ),
          },
        ]}
      />
    </Card>
  );
}
