import { Drawer } from 'antd';
import type { WithdrawalDetail } from './types';

type WithdrawalDetailDrawerProps = {
  detail: WithdrawalDetail | null;
  onClose: () => void;
};

export function WithdrawalDetailDrawer(
  props: WithdrawalDetailDrawerProps,
) {
  return (
    <Drawer
      width={720}
      open={props.detail !== null}
      onClose={props.onClose}
      title="提现详情"
    >
      <pre>{props.detail ? JSON.stringify(props.detail, null, 2) : ''}</pre>
    </Drawer>
  );
}
