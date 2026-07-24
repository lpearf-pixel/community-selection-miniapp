import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RoleWorkbench } from './RoleWorkbench';

describe('RoleWorkbench', () => {
  it('renders the owner workbench for the current admin role', () => {
    const markup = renderToStaticMarkup(
      <RoleWorkbench role="admin" onNavigate={vi.fn()} />,
    );

    expect(markup).toContain('今日经营工作台');
    expect(markup).toContain('当前工作台：经营负责人');
    expect(markup).toContain('订单管理');
    expect(markup).toContain('库存管理');
    expect(markup).toContain('财务对账');
    expect(markup).toContain('告警中心');
    expect(markup).toContain('实际权限仍由服务端校验');
  });

  it('renders the generic workbench for an unknown role', () => {
    const markup = renderToStaticMarkup(
      <RoleWorkbench role="unknown_role" onNavigate={vi.fn()} />,
    );

    expect(markup).toContain('当前工作台：综合运营');
  });
});
