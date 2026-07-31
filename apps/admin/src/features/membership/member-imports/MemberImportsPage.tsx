import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Space, Spin, Statistic, Typography } from 'antd';
import {
  confirmMemberImport, getMemberImport, listMemberImports, previewMemberImport,
  revokeMemberEligibility, type ImportBatch,
} from './api';

type ViewProps = {
  sourceName: string; fileName: string; busy: boolean; error: string;
  preview: ImportBatch | null; history: ImportBatch[];
  onSourceChange(value: string): void; onFileChange(file: File | null): void;
  onPreview(): void; onConfirm(): void; onSelectBatch(id: string): void; onRevoke(id: string): void;
};

const statusLabel: Record<string, string> = {
  preview: '待确认', confirmed: '已确认', pending: '待认领', active: '已生效', used: '已使用', revoked: '已撤销',
  invalid: '无效', duplicate: '重复', matched: '已匹配',
};

export function MemberImportsView(props: ViewProps) {
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert type="warning" showIcon message="会员优惠当前关闭，仅建立资格" description="导入不会立即启用 88 元会员或折扣；先预览，再确认导入。" />
      {props.error ? <Alert type="error" showIcon message="老会员导入操作失败" description={props.error} /> : null}
      <Card title="上传老会员名单（先预览，再确认导入）">
        <Space wrap>
          <Input aria-label="来源说明" placeholder="来源说明，例如：线下门店 2026-07 台账" value={props.sourceName} onChange={(event) => props.onSourceChange(event.target.value)} style={{ width: 320 }} />
          <input aria-label="会员文件" type="file" accept=".csv,.xlsx" onChange={(event) => props.onFileChange(event.currentTarget.files?.[0] ?? null)} />
          <Button type="primary" disabled={props.busy || !props.sourceName.trim() || !props.fileName} onClick={props.onPreview}>生成脱敏预览</Button>
          {props.fileName ? <Typography.Text>{props.fileName}</Typography.Text> : null}
        </Space>
      </Card>
      {props.busy ? <Spin tip="正在处理老会员名单" /> : null}
      {props.preview ? (
        <Card title={`批次 ${props.preview.id}`} extra={props.preview.status === 'preview' ? <Button danger onClick={props.onConfirm}>确认导入并建立资格</Button> : null}>
          <Space wrap>
            {Object.entries(props.preview.stats).map(([key, value]) => <Statistic key={key} title={key} value={value} />)}
          </Space>
          <table><thead><tr><th>行号</th><th>手机号</th><th>状态</th><th>说明</th></tr></thead>
            <tbody>{(props.preview.rows ?? []).map((row) => <tr key={row.id}><td>{row.rowNumber}</td><td>{row.maskedPhone ?? '—'}</td><td>{statusLabel[row.status] ?? row.status}</td><td>{row.invalidReason ?? ''}</td></tr>)}</tbody>
          </table>
          {(props.preview.eligibilities ?? []).length ? <>
            <Typography.Title level={5}>资格处理</Typography.Title>
            <table><tbody>{props.preview.eligibilities!.map((item) => <tr key={item.id}><td>{item.maskedPhone}</td><td>{statusLabel[item.status] ?? item.status}</td><td>{['pending', 'active'].includes(item.status) ? <Button danger size="small" onClick={() => props.onRevoke(item.id)}>撤销未使用资格</Button> : null}</td></tr>)}</tbody></table>
          </> : null}
        </Card>
      ) : null}
      <Card title="导入批次历史">
        <table><thead><tr><th>来源</th><th>文件</th><th>状态</th><th>总行数</th><th>操作</th></tr></thead>
          <tbody>{props.history.map((item) => <tr key={item.id}><td>{item.sourceName}</td><td>{item.fileName}</td><td>{statusLabel[item.status] ?? item.status}</td><td>{item.stats.total}</td><td><Button size="small" onClick={() => props.onSelectBatch(item.id)}>查看脱敏明细</Button></td></tr>)}</tbody>
        </table>
      </Card>
    </Space>
  );
}

export function MemberImportsPage() {
  const [sourceName, setSourceName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportBatch | null>(null);
  const [history, setHistory] = useState<ImportBatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const loadHistory = useCallback(async () => setHistory(await listMemberImports()), []);
  useEffect(() => { void loadHistory().catch((reason) => setError(reason instanceof Error ? reason.message : '批次加载失败')); }, [loadHistory]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败'); } finally { setBusy(false); }
  };
  return <MemberImportsView
    sourceName={sourceName} fileName={file?.name ?? ''} busy={busy} error={error} preview={preview} history={history}
    onSourceChange={setSourceName} onFileChange={setFile}
    onPreview={() => void run(async () => { if (!file) throw new Error('请选择文件'); setPreview(await previewMemberImport(file, sourceName)); await loadHistory(); })}
    onConfirm={() => void run(async () => { if (!preview) return; await confirmMemberImport(preview.id); setPreview(await getMemberImport(preview.id)); await loadHistory(); })}
    onSelectBatch={(id) => void run(async () => setPreview(await getMemberImport(id)))}
    onRevoke={(id) => void run(async () => { await revokeMemberEligibility(id); if (preview) setPreview(await getMemberImport(preview.id)); })}
  />;
}
