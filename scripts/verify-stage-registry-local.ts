import { existsSync, readFileSync } from 'node:fs';
import { STAGE_REGISTRY, assertStageRegistryFiles, getStageChain, latestRegisteredStage, registeredStageIds } from './stage-registry.ts';
function assert(value:unknown,message:string):asserts value {if(!value)throw new Error(message);}
assert(new Set(registeredStageIds()).size===STAGE_REGISTRY.length,'stage IDs must be unique');
assert(STAGE_REGISTRY.every((stage,index)=>index===0||stage.number>STAGE_REGISTRY[index-1].number),'stage numbers must be monotonic');
assertStageRegistryFiles();
assert(latestRegisteredStage().id==='L46','L46 must be latest registered stage');
assert(['L44','L45','L46'].every((id)=>getStageChain('L46').includes(id)),'L46 chain must include L44/L45/L46');
for(const file of ['scripts/stage-workflow.ts','scripts/generate-stage-report.ts','scripts/verify-report-publish-local.ts'])assert(readFileSync(file,'utf8').includes('stage-registry.ts'),`${file} must import registry`);
assert(!existsSync('scripts/l46-stage-registry.ts'),'second L46 registry is forbidden');
console.log('Stage registry checks passed.');
