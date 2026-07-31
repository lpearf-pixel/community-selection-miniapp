import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';

export const MEMBER_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const MEMBER_IMPORT_MAX_ROWS = 10_000;

const PHONE_HEADERS = new Set(['手机号', '手机号码', 'phone', 'mobile']);

export type ParsedMemberRow = {
  rowNumber: number;
  rawPhone: string;
};

export type MemberImportFile = {
  filename: string;
  buffer: Buffer;
};

function assertSize(buffer: Buffer) {
  if (buffer.byteLength > MEMBER_IMPORT_MAX_BYTES) {
    throw new Error('导入文件不能超过 5 MiB');
  }
}

function headerIndex(values: unknown[]): number {
  const index = values.findIndex((value) =>
    PHONE_HEADERS.has(String(value ?? '').trim().toLowerCase()),
  );
  if (index < 0) throw new Error('首行缺少支持的手机号列');
  return index;
}

function assertRowLimit(rows: ParsedMemberRow[]) {
  if (rows.length > MEMBER_IMPORT_MAX_ROWS) {
    throw new Error('导入文件最多包含 10,000 行数据');
  }
  return rows;
}

function parseCsv(buffer: Buffer): ParsedMemberRow[] {
  const records = parse(buffer, {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  }) as string[][];
  if (records.length === 0) throw new Error('导入文件为空');
  const index = headerIndex(records[0] ?? []);
  return assertRowLimit(
    records.slice(1).map((row, offset) => ({
      rowNumber: offset + 2,
      rawPhone: String(row[index] ?? '').trim(),
    })),
  );
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value) {
      throw new Error('Excel 手机号列不允许包含公式');
    }
    if ('richText' in value) {
      return value.richText.map((item) => item.text).join('').trim();
    }
    throw new Error('Excel 手机号列包含不支持的单元格类型');
  }
  return String(value).trim();
}

async function parseXlsx(buffer: Buffer): Promise<ParsedMemberRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('Excel 第一工作表不存在');
  const headers = (sheet.getRow(1).values as ExcelJS.CellValue[]).slice(1);
  const index = headerIndex(headers) + 1;
  const rows: ParsedMemberRow[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const rawPhone = cellText(sheet.getRow(rowNumber).getCell(index).value);
    if (rawPhone === '' && sheet.getRow(rowNumber).cellCount === 0) continue;
    rows.push({ rowNumber, rawPhone });
    if (rows.length > MEMBER_IMPORT_MAX_ROWS) assertRowLimit(rows);
  }
  return rows;
}

export async function parseMemberImportFile(
  input: MemberImportFile,
): Promise<ParsedMemberRow[]> {
  assertSize(input.buffer);
  const filename = input.filename.toLowerCase();
  if (filename.endsWith('.csv')) return parseCsv(input.buffer);
  if (filename.endsWith('.xlsx')) return parseXlsx(input.buffer);
  throw new Error('仅支持 CSV 或 .xlsx 文件');
}
