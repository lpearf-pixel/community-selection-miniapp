import type { ReactNode } from 'react';
import { Button, Layout, Space, Typography } from 'antd';
import type { AdminViewKey } from './admin-view';
import { createShellNavigationModel } from './shell-model';
import './AdminShell.css';

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
  const groups = createShellNavigationModel(
    props.activeView,
    props.onNavigate,
  );

  return (
    <section
      className="admin-shell"
      role="region"
      aria-label="社区甄选管理后台"
    >
      <header className="admin-shell__header">
        <div>
          <Typography.Title level={2}>社区甄选管理后台</Typography.Title>
          <Typography.Text type="secondary">
            统一管理线上商城与门店经营
          </Typography.Text>
        </div>
        <Space wrap className="admin-shell__account-actions">
          <div className="admin-shell__account">
            <Typography.Text>
              当前管理员：{props.admin.username}
            </Typography.Text>
            <Typography.Text type="secondary">
              角色：{props.admin.role}
            </Typography.Text>
          </div>
          <Space>
            <Button onClick={props.onRefresh}>刷新</Button>
            <Button onClick={props.onLogout}>退出登录</Button>
          </Space>
        </Space>
      </header>

      {props.message ? (
        <div className="admin-shell__message" role="status">
          <Typography.Text type="secondary">{props.message}</Typography.Text>
        </div>
      ) : null}

      <Layout className="admin-shell__body">
        <Layout.Sider
          width={272}
          theme="light"
          className="admin-shell__sidebar"
        >
          <nav
            className="admin-shell__navigation"
            aria-label="后台功能导航"
          >
            {groups.map((group) => (
              <section
                key={group.key}
                className="admin-shell__navigation-group"
                data-active={group.active || undefined}
                aria-labelledby={`admin-navigation-${group.key}`}
              >
                <Typography.Title
                  id={`admin-navigation-${group.key}`}
                  level={5}
                  className="admin-shell__navigation-heading"
                >
                  {group.label}
                </Typography.Title>
                <Space
                  direction="vertical"
                  size={4}
                  className="admin-shell__navigation-items"
                >
                  {group.items.map((item) => (
                    <Button
                      key={item.key}
                      block
                      className="admin-shell__navigation-button"
                      type={item.active ? 'primary' : 'text'}
                      aria-current={item.active ? 'page' : undefined}
                      onClick={item.onSelect}
                    >
                      {item.label}
                    </Button>
                  ))}
                </Space>
              </section>
            ))}
          </nav>
        </Layout.Sider>

        <Layout.Content className="admin-shell__content">
          {props.children}
        </Layout.Content>
      </Layout>
    </section>
  );
}
