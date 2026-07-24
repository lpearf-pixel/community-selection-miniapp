import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourcePath = (name: string) =>
  fileURLToPath(new URL(name, import.meta.url));
const source = (name: string) => readFileSync(sourcePath(name), 'utf8');

describe('withdrawals page source boundaries', () => {
  it('keeps the orchestrator at or below 200 lines', () => {
    expect(source('./WithdrawalsPage.tsx').trimEnd().split('\n').length)
      .toBeLessThanOrEqual(200);
  });

  it('delegates the workbench and detail drawer views', () => {
    const page = source('./WithdrawalsPage.tsx');
    for (const component of [
      'WithdrawalsWorkbench',
      'WithdrawalDetailDrawer',
    ]) {
      expect(page).toContain(`<${component}`);
      expect(existsSync(sourcePath(`./${component}.tsx`))).toBe(true);
      expect(source(`./${component}.tsx`)).toContain(
        `export function ${component}`,
      );
    }
    expect(page).not.toMatch(/<Table\b/);
    expect(page).not.toMatch(/<Drawer\b/);
    expect(page).not.toMatch(/<(Card|DatePicker\.RangePicker|Select|Input\.Search)\b/);
    expect(page).not.toContain('columns={[');
  });

  it('keeps extracted views synchronous and side-effect free', () => {
    for (const component of [
      'WithdrawalsWorkbench',
      'WithdrawalDetailDrawer',
    ]) {
      const view = source(`./${component}.tsx`);
      expect(view).not.toMatch(/from ['"]\.\/api['"]/);
      expect(view).not.toMatch(
        /\b(useState|useEffect|useReducer|useRef|useFeatureResourceLoader|AbortController)\b/,
      );
    }
  });
});
