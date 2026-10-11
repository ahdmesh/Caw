import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import assert from 'node:assert/strict';
const {copyMappingInput} = require('../../../src/evidence/optionA/mappingInput.ts');
const {createMappingBudgetBoundary} = require('../../../src/evidence/optionA/mappingBudget.ts');
const {bindNormalEvidence} = require('../../../src/evidence/optionA/evidenceBinding.ts');
import {fixture,specs,TOPICS} from './binding-fixtures.mjs';
import {snapshot,verifyInputUnchanged,verifyOutput} from './helpers.mjs';
const results=[],fault=new Error('EXPECTED_BINDING_CALLBACK_ERROR');
for(const spec of specs){
const raw=fixture();spec.mutate?.(raw);const snap=snapshot(raw),counter=createMappingBudgetBoundary();const copied=copyMappingInput(raw,counter);assert.equal(copied.kind,'INPUT_READY');
if(spec.reject)counter.reserveAux(33554432-counter.usedAux-16384);
const reservations=[],trace=[];
const connection={get phase(){return counter.phase;},reserveAux(n){if(spec.fault){reservations.push({bytes:n,outcome:'THROW'});throw fault;}const ok=counter.reserveAux(n);reservations.push({bytes:n,outcome:ok});return ok;},observe(x){trace.push('OBSERVATION');return counter.observe(x);},stopEvidence(x){trace.push('STOP_EVIDENCE');return counter.stopEvidence(x);},abortInput:e=>counter.abortInput(e)};
let result,error;try{result=bindNormalEvidence(copied.owned,copied.observationInput,connection,TOPICS);}catch(e){error=e;}
const row={id:spec.id,expected:spec.status,actual:error?'THROW':result.status,expectedReason:spec.reason,reasonCode:result?.reasonCode??null,phase:counter.phase,reservations,trace,inputBytes:copied.inputBytes,usedAux:counter.usedAux,exception:error?{message:error.message,expected:error===fault}:null,result:result??null};
try{assert.equal(row.actual,spec.status);assert.equal(row.reasonCode,spec.reason);verifyInputUnchanged(raw,snap);if(result)verifyOutput(result,snap);
 if(spec.status==='BOUND'){assert.equal(counter.phase,'ACTIVE');assert.equal(result.sourceIdentity.sourceLogIndex,raw.sources[0].sourceLogIndex);assert.equal(result.apCount,1);assert.equal(result.rejectedCount,0);assert.equal(copied.owned.transaction.blockNumber,(1n<<60n)+3n);assert.equal(typeof copied.owned.receipt.blockNumber,'bigint');assert.ok(!('mapping'in result)&&!('successfulActions'in result));}
 else if(error){assert.equal(error,fault);assert.equal(counter.phase,'ABORTED');assert.throws(()=>counter.reserveAux(1));}
 else{assert.equal(counter.phase,'STOPPED');assert.ok(!('sourceIdentity'in result));if(spec.reject){assert.equal(reservations.length,2);assert.equal(reservations[1].outcome,false);assert.equal(trace.length,0);}}
 row.pass=true;
}catch(e){row.pass=false;row.assertion=e.message;}
results.push(row);
}
console.log(JSON.stringify({runtime:process.version,eventTopics:'FIXED_COORDINATOR_PROVIDED',actualExistingBindingHelper:true,bigintAdapter:true,total:results.length,passed:results.filter(x=>x.pass).length,results},(_,v)=>typeof v==='bigint'?v.toString():v,2));process.exitCode=results.every(x=>x.pass)?0:1;
