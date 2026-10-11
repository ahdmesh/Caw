import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import assert from 'node:assert/strict';
const {createMappingBudgetBoundary: create} = require('./mappingBudget.fixture.ts');
const {createMappingBudgetBoundary: direct} = require('../../../../src/evidence/optionA/mappingBudget.ts');
const {setup,events,sentinel} = require('./bridge.ts');
import {base} from './fixtures.mjs';
import {snapshot,verifyInputUnchanged,verifyOutput,accounting} from './helpers.mjs';
const LIMIT=33554432, CONTROL=16384;
const specs=[
{id:'M01',status:'VERIFIED'},
{id:'M02',status:'VERIFIED',prior:100000},
{id:'M03',status:'RESOURCE_LIMIT',prior:LIMIT-CONTROL-65535,getter:true},
{id:'M04',status:'RESOURCE_LIMIT',prior:LIMIT-CONTROL-65600,getter:true},
{id:'M05',status:'RESOURCE_LIMIT',large:true},
{id:'M06',status:'CONTRADICTED',prior:LIMIT-CONTROL-68501,conflict:true},
{id:'M07',status:'THROW',mode:'reserveThrow'},
{id:'M08',status:'THROW',mode:'releaseThrow'},
{id:'M12',status:'VERIFIED',compare:true},
];
const results=[];
for(const s of specs){
 setup(s.mode??'normal');const b=create(),input=base();let getterCalls=0;
 if(s.prior)assert.equal(b.reserveAux(s.prior),true);
 if(s.getter)Object.defineProperty(input.scope,'versions',{enumerable:true,configurable:true,get(){getterCalls++;throw Error('GETTER');}});
 if(s.large)input.sources[0].data='0x'+'ab'.repeat(4192500);
 if(s.conflict)input.provenance.push({...input.provenance[0],provider:'different'});
 const before=snapshot(input);let gate,error;
 try{gate=b.observe(input);}catch(e){error=e;}
 const out=gate?.result??gate?.observation;
 const row={id:s.id,expected:s.status,actual:error?'THROW':out?.status,kind:gate?.kind,phase:b.phase,sharedRejected:b.sharedRejected,prior:s.prior??0,final:b.usedAux,events:[...events],getterCalls,output:out,exception:error?{message:error.message,expected:error===sentinel}:null};
 try{
  assert.equal(row.actual,s.status);verifyInputUnchanged(input,before);assert.equal(getterCalls,0);
  if(out){verifyOutput(gate,before);assert.ok(out.diagnostics.length<=32);if(out.status!=='VERIFIED')assert.ok(!('observations' in out)&&!('mapping' in out));}
  if(s.status==='VERIFIED'){
   assert.equal(gate.kind,'OBSERVATION_READY');assert.equal(b.phase,'ACTIVE');
   row.local=accounting(out);assert.equal(b.usedAux,CONTROL+(s.prior??0)+row.local.auxiliaryBytes);
   assert.deepEqual(events.filter(e=>e.op==='release').map(e=>e.bytes),[6,30]);
  }else if(s.status!=='THROW'){
   assert.equal(gate.kind,'STOP');assert.equal(b.phase,'STOPPED');
   assert.ok(out.unchecked.some(x=>x.code==='REMAINING_VALIDATION_NOT_ASSESSED'));
   if(s.id!=='M03'){row.local=accounting(out);assert.equal(b.usedAux,CONTROL+(s.prior??0)+row.local.auxiliaryBytes);}
  }
  if(s.id==='M03'){assert.equal(events.length,1);assert.equal(events[0].result,false);assert.equal(out.reasonCode,'OBSERVATION_CONTROL_RESERVATION_DENIED');}
  if(s.id==='M04'){assert.equal(events.length,2);assert.equal(events[1].result,false);}
  if(s.id==='M05'){assert.equal(b.sharedRejected,false);assert.equal(out.reasonCode,'AUXILIARY_BUDGET_EXCEEDED');}
  if(s.id==='M06'){assert.equal(b.sharedRejected,true);assert.equal(out.reasonCode,'PROVENANCE_ID_CONFLICT');assert.equal(row.local.normalizedRecords,0);}
  if(s.status==='THROW'){assert.equal(error,sentinel);assert.equal(gate,undefined);assert.equal(b.phase,'ABORTED');const used=b.usedAux;assert.throws(()=>b.reserveAux(1));assert.equal(b.usedAux,used);row.reuseRejected=true;}
  if(s.compare){const c=direct();assert.deepEqual(c.observe(base()),gate);assert.equal(c.usedAux,b.usedAux);}
  row.pass=true;
 }catch(e){row.pass=false;row.assertion=e.message;}
 results.push(row);
}
function invalid(id,fn){try{const evidence=fn();results.push({id,expected:'ABORTED',pass:true,...evidence});}catch(e){results.push({id,pass:false,assertion:e.message});}}
invalid('M09',()=>{const list=[];for(const n of [-1,0.5,Infinity,NaN,Number.MAX_SAFE_INTEGER+1]){const b=create(),old=b.usedAux;assert.throws(()=>b.reserveAux(n));assert.equal(b.phase,'ABORTED');assert.equal(b.usedAux,old);list.push(String(n));}return {invalidNumbers:list};});
invalid('M10',()=>{const runs=[];for(const mode of ['invalidRelease','doubleRelease']){setup(mode);const b=create();assert.throws(()=>b.observe(base()));assert.equal(b.phase,'ABORTED');assert.ok(b.usedAux>=CONTROL);const old=b.usedAux;assert.throws(()=>b.reserveAux(0));assert.equal(b.usedAux,old);runs.push({mode,used:b.usedAux,events:[...events]});}return {runs};});
invalid('M11',()=>{setup('reserveThrow');const b=create();assert.throws(()=>b.observe(base()));const used=b.usedAux;let calls=0;const input={};Object.defineProperty(input,'sources',{get(){calls++;throw Error('getter');}});assert.throws(()=>b.observe(input));assert.equal(calls,0);assert.equal(b.usedAux,used);assert.equal(b.phase,'ABORTED');return {getterCalls:calls,used};});
results.sort((a,b)=>a.id.localeCompare(b.id));
console.log(JSON.stringify({runtime:process.version,total:results.length,passed:results.filter(r=>r.pass).length,results},(_,v)=>typeof v==='bigint'?v.toString():v,2));process.exitCode=results.every(r=>r.pass)?0:1;
