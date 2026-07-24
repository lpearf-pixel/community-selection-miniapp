import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

describe('orders page structure', () => {
  it('keeps OrdersPage as a compact orchestrator', () => {
    const page = source('./OrdersPage.tsx');

    expect(page.split('\n').length).toBeLessThanOrEqual(200);
    expect(page).toContain("from './OrdersFilters'");
    expect(page).toContain("from './OrdersTable'");
    expect(page).toContain("from './OrderDetailsCard'");
    expect(page).not.toContain('<Form');
    expect(page).not.toContain('columns={[');
    expect(page).not.toContain('OrderTimelineLog 时间线');
  });

  it('keeps each extracted view in its own source file', () => {
    expect(source('./OrdersFilters.tsx')).toContain(
      'export function OrdersFilters',
    );
    expect(source('./OrdersTable.tsx')).toContain(
      'export function OrdersTable',
    );
    expect(source('./OrderDetailsCard.tsx')).toContain(
      'export function OrderDetailsCard',
    );
  });
});
