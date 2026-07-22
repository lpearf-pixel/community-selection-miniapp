import { describe, expect, it } from 'vitest';
import { App } from '../App';
import { AdminApp } from './AdminApp';

describe('admin entry point', () => {
  it('keeps App as the compatibility alias for AdminApp', () => {
    expect(App).toBe(AdminApp);
  });
});
