import { existsSync, readdirSync } from 'node:fs';
export type StageDefinition={id:string;number:number;title:string;verifier?:string;additionalVerifiers?:readonly string[];baseBranch?:string;chainStart?:string;runtimeMarkers?:readonly string[]};
const stage=(number:number,title:string):StageDefinition=>({id:`L${number}`,number,title,verifier:`scripts/${readdirSync('scripts').find((file)=>file.startsWith(`verify-l${number}-`) && file.endsWith('-local.ts')) ?? `verify-l${number}-missing-local.ts`}`,chainStart:'L24'});
export const STAGE_REGISTRY=[...Array.from({length:22},(_,i)=>stage(i+24,`L${i+24}`)),{id:'L46',number:46,title:'Admin Business Dashboard V2',verifier:'scripts/verify-l46-admin-business-dashboard-v2-local.ts',additionalVerifiers:['scripts/verify-l46-tax-record-db-scope-local.ts'],chainStart:'L24'}] as const satisfies readonly StageDefinition[];
export function getStageDefinition(id:string){return STAGE_REGISTRY.find((stage)=>stage.id===id.toUpperCase());}
export function latestRegisteredStage(){return STAGE_REGISTRY.at(-1)!;}
export function registeredStageIds(){return STAGE_REGISTRY.map((stage)=>stage.id);}
export function getStageChain(id:string){const target=getStageDefinition(id);if(!target)throw new Error(`Unknown stage: ${id}`);return STAGE_REGISTRY.filter((stage)=>stage.number<=target.number).map((stage)=>stage.id).reverse();}
export function assertStageRegistryFiles(){for(const stage of STAGE_REGISTRY){if(stage.verifier&&!existsSync(stage.verifier)) throw new Error(`Missing verifier: ${stage.verifier}`);for(const file of stage.additionalVerifiers??[])if(!existsSync(file))throw new Error(`Missing verifier: ${file}`);}}
