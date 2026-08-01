import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Popconfirm, Space, Spin, Tag, Typography } from 'antd';
import {
  deliverMemberGift,
  listMemberGiftClaims,
  writeOffMemberGift,
  type MemberGiftClaimItem,
} from './api';

type ViewProps = {
  busy: boolean;
  error: string;
  items: MemberGiftClaimItem[];
  onRefresh(): void;
  onDeliver(claimId: string): void;
  writeOffReasons: Record<string, 'damaged' | 'lost' | 'unsellable' | undefined>;
  onWriteOffReasonChange(claimId: string, reason: 'damaged' | 'lost' | 'unsellable'): void;
  onWriteOff(claimId: string, reason: 'damaged' | 'lost' | 'unsellable'): void;
};

const statusLabel: Record<MemberGiftClaimItem['status'], string> = {
  reserved: '待领取', released: '已释放', delivered: '已交付', written_off: '已报损',
};

export function MemberBenefitsView(props: ViewProps) {
  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <Alert type="info" showIcon message="赠品资格与实物库存分开管理" description="仅待领取记录可确认交付或报损；配送开始、已核销或已交付记录会阻断静默全额退款。" />
    {props.error ? <Alert type="error" showIcon message="会员权益履约加载失败" description={props.error} /> : null}
    <Card title="会员赠品履约" extra={<Button onClick={props.onRefresh}>刷新</Button>}>
      {props.busy ? <Spin /> : null}
      <table>
        <thead><tr><th>订单</th><th>会员</th><th>活动/赠品</th><th>状态</th><th>履约证据</th><th>操作</th></tr></thead>
        <tbody>{props.items.map((item) => <tr key={item.claim_id}>
          <td>{item.order_no}</td><td>{item.user_nickname}</td>
          <td>{item.campaign_name}<br /><Typography.Text type="secondary">{item.gift_product_name}</Typography.Text></td>
          <td><Tag>{statusLabel[item.status]}</Tag></td>
          <td>{item.fulfillment_started_at ? '已开始配送' : '尚未开始'}</td>
          <td>{item.status === 'reserved' ? <Space>
            <Popconfirm title="确认赠品已经交给会员？" onConfirm={() => props.onDeliver(item.claim_id)}><Button type="primary" size="small">确认交付</Button></Popconfirm>
            <select aria-label={`选择 ${item.order_no} 报损原因`} value={props.writeOffReasons[item.claim_id] ?? ''}
              onChange={(event) => props.onWriteOffReasonChange(item.claim_id, event.target.value as 'damaged' | 'lost' | 'unsellable')}>
              <option value="" disabled>选择报损原因</option>
              <option value="damaged">损坏</option><option value="lost">丢失</option><option value="unsellable">不可售</option>
            </select>
            <Popconfirm title="确认按所选原因报损且不恢复库存？"
              disabled={!props.writeOffReasons[item.claim_id]}
              onConfirm={() => props.onWriteOff(item.claim_id, props.writeOffReasons[item.claim_id]!)}>
              <Button danger size="small" disabled={!props.writeOffReasons[item.claim_id]}>报损</Button>
            </Popconfirm>
          </Space> : '—'}</td>
        </tr>)}</tbody>
      </table>
    </Card>
  </Space>;
}

function commandKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function MemberBenefitsPage({ refreshVersion = 0 }: { refreshVersion?: number }) {
  const [items, setItems] = useState<MemberGiftClaimItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [writeOffReasons, setWriteOffReasons] = useState<Record<string, 'damaged' | 'lost' | 'unsellable'>>({});
  const load = useCallback(async () => {
    setBusy(true); setError('');
    try { setItems((await listMemberGiftClaims()).items); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '加载失败'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load, refreshVersion]);
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await operation(); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败'); setBusy(false); }
  };
  return <MemberBenefitsView busy={busy} error={error} items={items} onRefresh={() => void load()}
    writeOffReasons={writeOffReasons}
    onWriteOffReasonChange={(id, reason) => setWriteOffReasons((current) => ({ ...current, [id]: reason }))}
    onDeliver={(id) => void run(() => deliverMemberGift(id, commandKey('gift-deliver')))}
    onWriteOff={(id, reason) => void run(() => writeOffMemberGift(id, reason, commandKey('gift-writeoff')))} />;
}
