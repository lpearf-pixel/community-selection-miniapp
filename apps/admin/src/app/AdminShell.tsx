import type { ReactNode } from 'react';
import { Button, Card, Layout, Space, Typography } from 'antd';
import type { AdminViewKey } from './admin-view';
import { createShellNavigationModel } from './shell-model';

export type AdminShellProps = {
  activeView: AdminViewKey;
  admin: { username: string; role: string };
  message: string;
  onNavigate: (view: AdminViewKey) => void;
  onRefresh: () => void;
  onLogout: () => void;
  children: ReactNode;
};

export function AdminShell(props: AdminShellProps) {
  const items = createShellNavigationModel(
    props.activeView,
    props.onNavigate,
  );

  return (
    <Layout style={{ minHeight: '100vh', padding: 24 }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card>
          <Typography.Title level={2}>社区甄选管理后台</Typography.Title>
          <Space wrap>
            {items.map((item) => (
              <Button
                key={item.key}
                type={item.active ? 'primary' : 'default'}
                onClick={item.onSelect}
              >
                {item.label}
              </Button>
            ))}
            <Button onClick={props.onRefresh}>刷新</Button>
            <Button onClick={props.onLogout}>退出登录</Button>
          </Space>
          <Typography.Text type="secondary">
            当前管理员：{props.admin.username}
          </Typography.Text>
          {props.message ? (
            <Typography.Text type="secondary">
              {props.message}
            </Typography.Text>
          ) : null}
        </Card>
        {props.children}
      </Space>
    </Layout>
  );
}
