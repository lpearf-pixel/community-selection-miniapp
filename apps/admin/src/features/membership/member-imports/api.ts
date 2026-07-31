import { adminApiUrl, adminJsonRequest } from '../../../shared/api/admin-api';

export type ImportStats = {
  total: number; valid: number; duplicate: number; invalid: number; matched: number; pending: number;
};
export type ImportRow = {
  id: string; rowNumber: number; maskedPhone: string | null; status: string; invalidReason?: string | null;
  phoneFingerprint?: string;
};
export type Eligibility = { id: string; maskedPhone: string; status: string };
export type ImportBatch = {
  id: string; sourceName?: string; fileName?: string; status: string; createdAt?: string;
  stats: ImportStats; rows?: ImportRow[]; eligibilities?: Eligibility[];
};

export async function previewMemberImport(file: File, sourceName: string): Promise<ImportBatch> {
  const form = new FormData();
  form.append('source_name', sourceName);
  form.append('file', file);
  const response = await fetch(adminApiUrl('/api/admin/member-imports/preview'), {
    method: 'POST', body: form, credentials: 'include',
  });
  const envelope = await response.json() as { success: boolean; data?: ImportBatch; message?: string };
  if (!response.ok || !envelope.success || !envelope.data) throw new Error(envelope.message ?? '导入预览失败');
  return envelope.data;
}

export const listMemberImports = () => adminJsonRequest<ImportBatch[]>('/api/admin/member-imports');
export const getMemberImport = (id: string) => adminJsonRequest<ImportBatch>(`/api/admin/member-imports/${id}`);
export const confirmMemberImport = (id: string) => adminJsonRequest(`/api/admin/member-imports/${id}/confirm`, { method: 'POST' });
export const revokeMemberEligibility = (id: string) => adminJsonRequest(`/api/admin/member-import-eligibilities/${id}/revoke`, { method: 'POST' });
