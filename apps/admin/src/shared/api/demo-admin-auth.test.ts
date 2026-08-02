import { describe, expect, it } from 'vitest';
import { demoAdminAuthHeaders } from './demo-admin-auth';

describe('demoAdminAuthHeaders', () => {
  it('adds the configured token only in the local Vite development runtime', () => {
    expect(
      demoAdminAuthHeaders({ dev: true, token: ' strong-local-token ' }),
    ).toEqual({ 'x-admin-token': 'strong-local-token' });
    expect(
      demoAdminAuthHeaders({ dev: false, token: 'strong-local-token' }),
    ).toEqual({});
    expect(demoAdminAuthHeaders({ dev: true, token: '  ' })).toEqual({});
  });
});
