import { Card, Layout, Typography } from 'antd';

export function App() {
  return (
    <Layout style={{ minHeight: '100vh', padding: 24 }}>
      <Card>
        <Typography.Title level={2}>社区甄选管理后台</Typography.Title>
        <Typography.Paragraph>
          第一阶段已搭建 React、Vite 与 Ant Design 管理后台骨架。
        </Typography.Paragraph>
      </Card>
    </Layout>
  );
}
