import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourcePath = (name: string) =>
  fileURLToPath(new URL(name, import.meta.url));
const source = (name: string) => readFileSync(sourcePath(name), 'utf8');

describe('group buy page source boundaries', () => {
  it('keeps the orchestrator at or below 200 lines', () => {
    const page = source('./GroupBuyManagementPage.tsx');

    expect(page.trimEnd().split('\n').length).toBeLessThanOrEqual(200);
  });

  it('delegates the list and closure workbench views', () => {
    const page = source('./GroupBuyManagementPage.tsx');

    for (const component of [
      'GroupBuyListCard',
      'GroupBuyClosureWorkbench',
    ]) {
      expect(page).toContain(`<${component}`);
      expect(existsSync(sourcePath(`./${component}.tsx`))).toBe(true);
      expect(source(`./${component}.tsx`)).toContain(
        `export function ${component}`,
      );
    }

    expect(page).not.toMatch(/<Table\b/);
    expect(page).not.toMatch(/<Card\b/);
    expect(page).not.toMatch(/<Select\b/);
    expect(page).not.toContain('columns={[');
  });
});
