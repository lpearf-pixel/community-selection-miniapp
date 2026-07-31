import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseMemberImportFile } from './member-file-parser.js';

describe('legacy member file parser', () => {
  it('reads a UTF-8 CSV phone alias and keeps row numbers', async () => {
    const rows = await parseMemberImportFile({
      filename: 'members.csv',
      buffer: Buffer.from('姓名,手机号\n甲,13800138000\n乙,+86 139-0013-9000\n'),
    });
    expect(rows).toEqual([
      { rowNumber: 2, rawPhone: '13800138000' },
      { rowNumber: 3, rawPhone: '+86 139-0013-9000' },
    ]);
  });

  it('reads only the first Excel worksheet', async () => {
    const workbook = new ExcelJS.Workbook();
    const first = workbook.addWorksheet('first');
    first.addRow(['mobile']);
    first.addRow(['13800138000']);
    const second = workbook.addWorksheet('second');
    second.addRow(['mobile']);
    second.addRow(['13900139000']);
    const bytes = await workbook.xlsx.writeBuffer();
    await expect(
      parseMemberImportFile({ filename: 'members.xlsx', buffer: Buffer.from(bytes) }),
    ).resolves.toEqual([{ rowNumber: 2, rawPhone: '13800138000' }]);
  });

  it('rejects formulas instead of evaluating spreadsheet content', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('members');
    sheet.addRow(['手机号']);
    sheet.getCell('A2').value = { formula: '1+1', result: '13800138000' };
    const bytes = await workbook.xlsx.writeBuffer();
    await expect(
      parseMemberImportFile({ filename: 'members.xlsx', buffer: Buffer.from(bytes) }),
    ).rejects.toThrow('公式');
  });

  it('rejects files without a supported phone column', async () => {
    await expect(
      parseMemberImportFile({
        filename: 'members.csv',
        buffer: Buffer.from('姓名\n甲\n'),
      }),
    ).rejects.toThrow('手机号列');
  });

  it('enforces the five MiB upload boundary', async () => {
    await expect(
      parseMemberImportFile({
        filename: 'members.csv',
        buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
      }),
    ).rejects.toThrow('5 MiB');
  });

  it('enforces the ten-thousand data row boundary', async () => {
    const content = `phone\n${Array.from({ length: 10_001 }, () => '13800138000').join('\n')}`;
    await expect(
      parseMemberImportFile({ filename: 'members.csv', buffer: Buffer.from(content) }),
    ).rejects.toThrow('10,000');
  });

  it('rejects unsupported file extensions', async () => {
    await expect(
      parseMemberImportFile({ filename: 'members.txt', buffer: Buffer.from('phone') }),
    ).rejects.toThrow('CSV 或 .xlsx');
  });
});
