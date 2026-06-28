import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

describe('GET /health', () => {
  it('returns standard API response', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: { status: 'ok', service: 'api' },
      message: ''
    });
  });
});
