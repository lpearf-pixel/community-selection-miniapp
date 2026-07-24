import { Button, Card, Space, Typography } from 'antd';
import type { AdminViewKey } from './admin-view';
import { createRoleWorkbenchModel } from './role-workbench';

export type RoleWorkbenchProps = {
  role: string;
  onNavigate: (view: AdminViewKey) => void;
};

export function RoleWorkbench(props: RoleWorkbenchProps) {
  const model = createRoleWorkbenchModel(props.role);

  return (
    <section aria-label="今日经营角色工作台">
      <Card title="今日经营工作台">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text strong>
            当前工作台：{model.label}
          </Typography.Text>
          <Typography.Paragraph style={{ marginBottom: 0 }}>
            {model.description}
          </Typography.Paragraph>
          <Space wrap>
            {model.actions.map((action) => (
              <Button
                key={action.target}
                onClick={() => props.onNavigate(action.target)}
              >
                {action.label}
              </Button>
            ))}
          </Space>
          <Typography.Text type="secondary">
            快捷入口只用于工作编排，实际权限仍由服务端校验。
          </Typography.Text>
        </Space>
      </Card>
    </section>
  );
}
