import { existsSync, readFileSync } from 'node:fs';
import { STAGE_REGISTRY, assertStageRegistryFiles, getStageChain, getStageDefinition, latestRegisteredStage, registeredStageIds } from './stage-registry.ts';
function assert(value:unknown,message:string):asserts value {if(!value)throw new Error(message);}
assert(new Set(registeredStageIds()).size===STAGE_REGISTRY.length,'stage IDs must be unique');
assert(STAGE_REGISTRY.every((stage,index)=>index===0||stage.number>STAGE_REGISTRY[index-1].number),'stage numbers must be monotonic');
assertStageRegistryFiles();
assert(latestRegisteredStage().id==='L46','L46 must be latest registered stage');
assert(['L44','L45','L46'].every((id)=>getStageChain('L46').includes(id)),'L46 chain must include L44/L45/L46');
for(const file of ['scripts/stage-workflow.ts','scripts/generate-stage-report.ts','scripts/verify-report-publish-local.ts'])assert(readFileSync(file,'utf8').includes('stage-registry.ts'),`${file} must import registry`);
assert(!existsSync('scripts/l46-stage-registry.ts'),'second L46 registry is forbidden');
console.log('Stage registry checks passed.');
const registrySource=readFileSync('scripts/stage-registry.ts','utf8');
assert(!registrySource.includes('readdirSync'),'registry must not auto-discover verifiers');
assert(STAGE_REGISTRY.map(s=>s.number).every((n,i,a)=>n===24+i),'L24-L46 numbers must be continuous');
assert(getStageDefinition('L46')?.additionalVerifiers?.includes('scripts/verify-l46-tax-record-db-scope-local.ts'),'L46 additional verifier missing');
assert(readFileSync('scripts/run-registered-stage-verifiers.ts','utf8').includes('stage-registry.ts'),'runner must import registry');
const verifyAll=readFileSync('scripts/verify-all-local.sh','utf8');
assert(verifyAll.includes('run-registered-stage-verifiers.ts')&&!/verify-l(2[4-9]|3\d|4[0-6]).*-local\.ts/.test(verifyAll),'verify-all must use runner only for L24-L46');
