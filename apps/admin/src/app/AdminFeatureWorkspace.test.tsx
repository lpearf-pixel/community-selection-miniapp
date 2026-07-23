import { describe, expect, it, vi } from 'vitest';
import { AdminFeatureWorkspace } from './AdminFeatureWorkspace';

describe('AdminFeatureWorkspace', () => {
  it('defers feature rendering to a child below the error boundary', () => {
    const render = vi.fn(() => null);
    const element = <AdminFeatureWorkspace render={render} />;

    expect(render).not.toHaveBeenCalled();
    expect(AdminFeatureWorkspace(element.props)).toBeNull();
    expect(render).toHaveBeenCalledOnce();
  });
});
