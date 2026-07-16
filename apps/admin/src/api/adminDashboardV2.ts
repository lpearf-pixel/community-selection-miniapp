import { requestAdminJson } from './adminRequest';
export type DashboardQuery = { from?:string; to?:string; community_id?:string; pickup_store_id?:string; timezone?:string };
const query=(q:DashboardQuery)=>{const s=new URLSearchParams();Object.entries(q).forEach(([k,v])=>v&&s.set(k,v));return s.toString();};
export const getDashboardV2Overview=(q:DashboardQuery,signal?:AbortSignal)=>requestAdminJson<any>(`/api/admin/dashboard-v2/overview?${query(q)}`,{signal});
export const getDashboardV2Trends=(q:DashboardQuery,signal?:AbortSignal)=>requestAdminJson<any>(`/api/admin/dashboard-v2/trends?${query(q)}`,{signal});
export const getDashboardV2Alerts=(q:DashboardQuery,signal?:AbortSignal)=>requestAdminJson<any>(`/api/admin/dashboard-v2/alerts?${query(q)}`,{signal});
