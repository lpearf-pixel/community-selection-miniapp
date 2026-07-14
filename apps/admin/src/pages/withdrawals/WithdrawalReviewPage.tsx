import { useEffect, useState } from "react";
import { Button, Card, DatePicker, Drawer, Input, message, Select, Space, Table, Tag, Typography } from "antd";
import { formatYuan } from "@community-selection/shared";
import { AdminWithdrawal, AdminWithdrawalDetail, approveWithdrawal, getAdminWithdrawal, listAdminWithdrawals, markWithdrawalPaid, rejectWithdrawal } from "../../api/adminWithdrawals";

const statusText: Record<string, string> = { pending: "待审核", approved: "已通过", rejected: "已拒绝", paid: "已处理" };
const statusColor: Record<string, string> = { pending: "orange", approved: "blue", rejected: "red", paid: "green" };

export function WithdrawalReviewPage() {
  const [rows, setRows] = useState<AdminWithdrawal[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>();
  const [keyword, setKeyword] = useState("");
  const [range, setRange] = useState<[string, string] | undefined>();
  const [acting, setActing] = useState(false);
  const [detail, setDetail] = useState<AdminWithdrawalDetail | null>(null);
  const load = async (nextPage = page) => { setLoading(true); try { const data = await listAdminWithdrawals({ status, keyword, from: range?.[0], to: range?.[1], page: nextPage, page_size: 20 }); setRows(data.items); setTotal(data.total); setPage(data.page); } catch (e) { message.error(e instanceof Error ? e.message : "加载失败"); } finally { setLoading(false); } };
  useEffect(() => { void load(1); }, [status, range]);
  const openDetail = async (id: string) => { try { setDetail(await getAdminWithdrawal(id)); } catch (e) { message.error(e instanceof Error ? e.message : "详情加载失败，可能无 data scope 权限"); } };
  const prompt = async (title: string, label: string, onOk: (value: string) => Promise<unknown>) => { const value = window.prompt(`${title}：${label}`); if (!value?.trim()) { message.warning(`${label}必填`); return; } setActing(true); try { await onOk(value.trim()); message.success("操作成功，仅人工审核与人工处理记录，系统不会自动打款"); await load(); } catch (e) { message.error(e instanceof Error ? e.message : "操作失败"); } finally { setActing(false); } };
  return <Card title="L44 提现人工审核工作台" extra={<Space wrap><Select allowClear placeholder="状态筛选" style={{ width: 140 }} value={status} onChange={setStatus} options={["pending","approved","rejected","paid"].map((v) => ({ value: v, label: statusText[v] }))} /><Input.Search placeholder="Leader ID/昵称/申请编号" value={keyword} onChange={(e) => setKeyword(e.target.value)} onSearch={() => load(1)} /><DatePicker.RangePicker onChange={(_, s) => setRange(s[0] && s[1] ? [s[0], s[1]] : undefined)} /></Space>}>
    <Typography.Paragraph type="warning">仅人工审核与人工处理记录；审核通过后由工作人员线下处理，系统不会自动打款。遇到 ADMIN_SCOPE_FORBIDDEN 表示当前账号无该提现全部关联社区/订单的数据范围。</Typography.Paragraph>
    <Table rowKey="withdrawal_id" loading={loading} dataSource={rows} pagination={{ current: page, total, pageSize: 20, onChange: (p) => load(p) }} columns={[{ title: "申请编号", dataIndex: "client_request_id" }, { title: "Leader", render: (_, r) => `${r.leader_nickname} ${r.leader_phone_masked ?? ""}` }, { title: "社区", render: (_, r) => r.community_names.join("、") }, { title: "金额", render: (_, r) => formatYuan(r.amount_cents) }, { title: "状态", render: (_, r) => <Tag color={statusColor[r.status]}>{statusText[r.status]}</Tag> }, { title: "奖励笔数", dataIndex: "commission_count" }, { title: "操作", render: (_, r) => <Space><Button onClick={() => openDetail(r.withdrawal_id)}>详情</Button><Button disabled={r.status !== "pending" || acting} onClick={() => prompt("审核通过", "审核备注", (v) => approveWithdrawal(r.withdrawal_id, v))}>审核通过</Button><Button danger disabled={r.status !== "pending" || acting} onClick={() => prompt("驳回", "驳回原因", (v) => rejectWithdrawal(r.withdrawal_id, v))}>驳回</Button><Button type="primary" disabled={r.status !== "approved" || acting} onClick={() => prompt("人工标记已处理", "人工转账记录号或内部处理编号", (v) => markWithdrawalPaid(r.withdrawal_id, v, "人工处理完成"))}>标记已处理</Button></Space> }]} />
    <Drawer width={720} open={!!detail} onClose={() => setDetail(null)} title="提现详情"><pre>{detail ? JSON.stringify(detail, null, 2) : ""}</pre></Drawer>
  </Card>;
}
