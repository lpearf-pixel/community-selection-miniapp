export function hasUnsafeDropTable(sql: string): boolean {
  return /DROP\s+TABLE\s+(?!IF\s+EXISTS)/i.test(sql);
}
