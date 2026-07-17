export function extractMarkdownFilePaths(report: string): string[] {
  const section = report.split('## 2. 本阶段变更范围')[1]?.split('## 3. API 变化')[0] ?? '';
  const files: string[] = [];
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 3) continue;
    const file = cells[1];
    if (!file || file === '文件' || file === '---') continue;
    files.push(file);
  }
  return Array.from(new Set(files)).sort();
}
