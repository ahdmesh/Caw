import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import assert from 'node:assert/strict';
const {mapNormal} = require('../../../src/evidence/optionA/index.ts');
const {runNormal,normalDependencies} = require('../../../src/evidence/optionA/normalInternal.ts');
import {fixture,cases} from './integration-fixtures.mjs';
const json=v=>JSON.stringify(v,(_,v)=>typeof v==='bigint'?v.toString():v);
function nodes(x,set=new Set()) {if(x&&typeof x==='object'&&!set.has(x)){set.add(x);for(const d of Object.values(Object.getOwnPropertyDescriptors(x)))if('value'in d)nodes(d.value,set);}return set;}
function immutable(x){for(const v of nodes(x)){assert.ok(Object.isFrozen(v));assert.equal(ArrayBuffer.isView(v),false);}}
const rows=[];
for(const spec of cases){
 const row={id:spec.id,expected:spec.status,expectedReason:spec.reason};
 try{
  const f=fixture(spec.multi),counts={getters:0,parser:0,commitment:0,reserves:0,readsAfterDenial:0},fault=new Error('INTERNAL_TEST_FAULT');
  spec.mutate?.(f,counts);const before=spec.getter?null:json(f.input),inputNodes=nodes(f.input),reservations=[];
  let actualCounter,result,error,denied=false;
  const deps={...normalDependencies,
   createCounter(){const c=normalDependencies.createCounter();actualCounter=c;
    return {...c,get phase(){return c.phase;},get usedAux(){return c.usedAux;},get sharedRejected(){return c.sharedRejected;},get observationResult(){return c.observationResult;},
     reserveAux(n){counts.reserves++;
      if(denied)counts.readsAfterDenial++;
      if(n===spec.throwBytes){reservations.push({bytes:n,outcome:'THROW'});throw fault;}
      if(n===spec.denyBytes){c.reserveAux(33554432-c.usedAux);}
      const ok=c.reserveAux(n);reservations.push({bytes:n,outcome:ok});if(!ok)denied=true;return ok;
     }};},
   parseActions(p){counts.parser++;if(spec.parserFault)throw fault;return normalDependencies.parseActions(p);},
   commitment(...args){counts.commitment++;if(spec.commitmentFault)throw fault;return normalDependencies.commitment(...args);},
  };
  try{result=runNormal(f.input,deps);}catch(e){error=e;}
  row.actual=error?'THROW':result.status;row.reasonCode=result?.reasonCode??null;
  assert.equal(row.actual,spec.status);assert.equal(row.reasonCode,spec.reason);
  assert.equal(counts.getters,0);assert.equal(counts.readsAfterDenial,0);
  if(before!==null)assert.equal(json(f.input),before);
  if(error){assert.equal(error,fault);assert.equal(actualCounter.phase,'ABORTED');assert.throws(()=>actualCounter.reserveAux(1));}
  else{
   immutable(result);for(const obj of nodes(result))assert.ok(!inputNodes.has(obj),'mutable/raw reference leaked');
   assert.equal(result.verificationScope,'PROVIDED_EVIDENCE_ONLY');assert.equal(result.canonicality,'NOT_ASSESSED');assert.equal(result.finality,'NOT_ASSESSED');assert.ok(result.diagnostics.length<=32);
   if(result.status==='VERIFIED'){
    const m=result.mapping;assert.equal(m.profile,'NORMAL');assert.equal(m.outcomeKind,'HAS_SUCCESS');
    assert.equal(m.commitment.events.length,1);assert.equal(m.successfulActionCount,m.actions.length);assert.deepEqual(m.callPath,[]);
    assert.deepEqual(m.actions.map(a=>a.identity.actionOrdinal),Array.from({length:m.actions.length},(_,i)=>i));
    assert.deepEqual(m.groups.flatMap(g=>g.actions),m.actions);
    for(const g of m.groups){assert.ok(g.actions.length);assert.deepEqual(g.actions.map(a=>a.groupActionOrdinal),Array.from({length:g.actions.length},(_,i)=>i));}
    for(const a of m.actions)assert.equal(a.source,m.sourceCorrespondence[0]);
    assert.equal(counts.parser,1);assert.equal(counts.commitment,1);
    if(spec.id==='N03-REACQUISITION'){
      assert.deepEqual(m.sourceCorrespondence[0].inputRefs.map(r=>r.id),['s1','s2']);
      assert.deepEqual(m.sourceCorrespondence[0].provenance.map(r=>r.id),['p1','p2']);
      assert.deepEqual(result.provenance.map(p=>p.id),['p1','p2']);
    }
    assert.ok(result.checked.some(x=>x.code==='NORMAL_AP_COMMITMENT_ESTABLISHED'));
    assert.ok(!result.unchecked.some(x=>x.code==='RECEIPT_MAPPING_COMMITMENT_NOT_ASSESSED'));
    assert.ok(result.diagnostics.some(x=>x.reasonCode==='OBSERVATION_ACCOUNTING'));
    const snapshot=json(result);f.input.sources[0].data='0x';f.input.provenance[0].provider='changed';assert.equal(json(result),snapshot);
   }else{
    for(const k of ['mapping','observations','successfulActions','commitment'])assert.ok(!(k in result));
    assert.equal(actualCounter.phase,'STOPPED');
    assert.ok(result.unchecked.length>0);
   }
  }
  // Actual public entrypoint is exercised on every non-fault fixture too.
  if(!spec.denyBytes&&!spec.throwBytes&&!spec.parserFault&&!spec.commitmentFault){
   const f2=fixture(spec.multi);spec.mutate?.(f2,{getters:0});const pub=mapNormal(f2.input);
   assert.equal(pub.status,spec.status);assert.equal(pub.reasonCode,spec.reason);
  }
  row.phase=actualCounter.phase;row.usedAux=actualCounter.usedAux;row.counts=counts;row.reservations=reservations;
  row.checked=result?.checked;row.unchecked=result?.unchecked;row.inputRefs=result?.inputRefs;
  row.exception=error?{originalPreserved:error===fault}:null;row.pass=true;
 }catch(e){row.pass=false;row.failure=e.stack;}
 rows.push(row);
}
console.log(JSON.stringify({node:process.version,total:rows.length,passed:rows.filter(r=>r.pass).length,results:rows},null,2));
process.exitCode=rows.every(r=>r.pass)?0:1;
