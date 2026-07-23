import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Alert, Button } from 'antd';

type Props = {
  resetKey: string;
  children: ReactNode;
};

type State = {
  error: Error | null;
};

export class AdminErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('admin-page-render-failed', {
      name: error.name,
      message: error.message,
      componentStack: info.componentStack,
    });
  }

  componentDidUpdate(previous: Props) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Alert
        type="error"
        showIcon
        message="当前页面加载失败"
        description="其他后台模块仍可使用。请重试，若重复发生请记录时间和页面。"
        action={
          <Button onClick={() => this.setState({ error: null })}>
            重试当前页面
          </Button>
        }
      />
    );
  }
}
