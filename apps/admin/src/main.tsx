import React from 'react';
import ReactDOM from 'react-dom/client';
import { App as AntApp, Card, ConfigProvider, Layout, Typography } from 'antd';
import 'antd/dist/reset.css';
import './style.css';

const { Header, Content } = Layout;

const Dashboard = () => (
  <ConfigProvider theme={{ token: { colorPrimary: '#16a34a' } }}>
    <AntApp>
      <Layout className="admin-layout">
        <Header className="admin-header">社区甄选管理后台</Header>
        <Content className="admin-content">
          <Card title="阶段 1 项目骨架">
            <Typography.Paragraph>
              已接入 React、Vite 与 Ant Design，后续阶段将补齐商品、团购、订单、退款和开团服务奖励管理能力。
            </Typography.Paragraph>
          </Card>
        </Content>
      </Layout>
    </AntApp>
  </ConfigProvider>
);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Dashboard />
  </React.StrictMode>
);
