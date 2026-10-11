import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import assert from 'node:assert/strict';
const {copyMappingInput} = require('../../../src/evidence/optionA/mappingInput.ts');
const {createMappingBudgetBoundary} = require('../../../src/evidence/optionA/mappingBudget.ts');
const {bindNormalEvidence} = require('../../../src/evidence/optionA/evidenceBinding.ts');
import {fixture,specs,TOPICS} from './fix-fixtures.mjs';
import {snapshot,verifyInputUnchanged,verifyOutput} from './helpers.mjs';
const results=[],fault=new Error('EXPECTED_BINDING_CALLBACK_ERROR');
for(const spec of specs){
const raw=fixture();spec.mutate?.(raw);const snap=snapshot(raw),counter=createMappingBudgetBoundary();const copied=copyMappingInput(raw,counter);assert.equal(copied.kind,'INPUT_READY');
if(spec.reject)counter.reserveAux(33554432-counter.usedAux-16384);
if(spec.rejectKnown){const scan=1024+(copied.owned.receipt.logs?.length??0)*2048+copied.owned.sources.length*2048+copied.owned.provenance.length*96;counter.reserveAux(33554432-counter.usedAux-16384-scan);}
const reservations=[],trace=[];let postRejectReads=0,rejectionObserved=false;
const connection={get phase(){return counter.phase;},reserveAux(n){if(spec.fault || (spec.faultKnown && reservations.length===2)){reservations.push({bytes:n,outcome:'THROW'});throw fault;}const ok=counter.reserveAux(n);reservations.push({bytes:n,outcome:ok});if(!ok&&spec.rejectKnown)rejectionObserved=true;return ok;},observe(x){trace.push('OBSERVATION');return counter.observe(x);},stopEvidence(x){trace.push('STOP_EVIDENCE');return counter.stopEvidence(x);},abortInput:e=>counter.abortInput(e)};
// Test-only observation of post-refusal access; not raw Proxy acceptance.
const bindOwned=new Proxy(copied.owned,{get(target,key,receiver){if(rejectionObserved){postRejectReads++;throw new Error('POST_REJECTION_SCAN');}return Reflect.get(target,key,receiver);}});
let result,error;try{result=bindNormalEvidence(bindOwned,copied.observationInput,connection,TOPICS);}catch(e){error=e;}
const row={id:spec.id,expected:spec.status,actual:error?'THROW':result.status,expectedReason:spec.reason,reasonCode:result?.reasonCode??null,phase:counter.phase,reservations,trace,inputBytes:copied.inputBytes,usedAux:counter.usedAux,postRejectReads,exception:error?{message:error.message,expected:error===fault}:null,result:result??null};
try{assert.equal(row.actual,spec.status);assert.equal(row.reasonCode,spec.reason);verifyInputUnchanged(raw,snap);if(result)verifyOutput(result,snap);
 if(spec.status==='BOUND'){assert.equal(counter.phase,'ACTIVE');assert.equal(result.sourceIdentity.sourceLogIndex,raw.sources[0].sourceLogIndex);assert.equal(result.apCount,1);assert.equal(result.rejectedCount,0);assert.equal(copied.owned.transaction.blockNumber,(1n<<60n)+3n);assert.equal(typeof copied.owned.receipt.blockNumber,'bigint');assert.ok(!('mapping'in result)&&!('successfulActions'in result));}
 else if(error){assert.equal(error,fault);assert.equal(counter.phase,'ABORTED');assert.throws(()=>counter.reserveAux(1));}
 else{assert.equal(counter.phase,'STOPPED');assert.ok(!('sourceIdentity'in result));if(spec.reject){assert.equal(reservations.length,2);assert.equal(reservations[1].outcome,false);assert.equal(trace.length,0);}}
 if(spec.rejectKnown){assert.equal(reservations.length,3);assert.equal(reservations[2].outcome,false);assert.equal(trace.length,0);assert.equal(postRejectReads,0);}
 row.pass=true;
}catch(e){row.pass=false;row.assertion=e.message;}
results.push(row);
}
console.log(JSON.stringify({runtime:process.version,eventTopics:'FIXED_COORDINATOR_PROVIDED',actualExistingBindingHelper:true,bigintAdapter:true,total:results.length,passed:results.filter(x=>x.pass).length,results},(_,v)=>typeof v==='bigint'?v.toString():v,2));process.exitCode=results.every(x=>x.pass)?0:1;
