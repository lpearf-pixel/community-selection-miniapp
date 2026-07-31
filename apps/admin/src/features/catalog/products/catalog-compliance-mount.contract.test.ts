import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('catalog compliance mount contract', () => {
  it('mounts the workbench without replacing existing status controls or auto-submitting', () => {
    const source = readFileSync(
      new URL('./CatalogProductsPage.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('<CatalogProductsTable');
    expect(source).toContain('onToggleStatus={toggleStatus}');
    expect(source).toContain('<CatalogProductForm');
    expect(source).toContain('<ProductCompliancePanel');
    expect(source).toContain('productId={editingProduct.id}');
    expect(source).not.toContain('submitProductCompliance(');
    expect(source).not.toContain('auto_approve');
  });
});
