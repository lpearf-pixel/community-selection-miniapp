import { describe, expect, it } from 'vitest';
import { containsUnsafeDropTable, stripSqlComments } from './sql-migration-safety';

describe('SQL migration safety', () => {
  it('ignores drop examples that exist only in comments or quoted values', () => {
    expect(containsUnsafeDropTable('-- DROP TABLE audit;')).toBe(false);
    expect(containsUnsafeDropTable('/* DROP TABLE audit; */')).toBe(false);
    expect(containsUnsafeDropTable("SELECT 'DROP TABLE audit;';")).toBe(false);
    expect(containsUnsafeDropTable('SELECT $$DROP TABLE audit;$$;')).toBe(false);
  });

  it('preserves token boundaries and finds comment-separated unsafe drops', () => {
    expect(containsUnsafeDropTable('DROP/* reason */TABLE audit;')).toBe(true);
    expect(containsUnsafeDropTable('/* -- */ DROP TABLE audit;')).toBe(true);
    expect(containsUnsafeDropTable("SELECT '--'; DROP TABLE audit;")).toBe(true);
  });

  it('handles nested block comments and still checks following SQL', () => {
    const sql = '/* outer /* DROP TABLE hidden; */ done */ DROP TABLE audit;';
    expect(containsUnsafeDropTable(sql)).toBe(true);
    expect(stripSqlComments(sql)).toContain('DROP TABLE audit;');
  });

  it('allows explicitly idempotent executable drops', () => {
    expect(containsUnsafeDropTable('DROP TABLE IF EXISTS audit;')).toBe(false);
    expect(
      containsUnsafeDropTable('DROP/* reason */TABLE IF EXISTS audit;'),
    ).toBe(false);
  });
});
