import type {MappingInput, ObservationInput, NonVerifiedResult} from './types';
import type {createMappingBudgetBoundary} from './mappingBudget';
import {verifyReceiptEvidenceSet, verifyCanonicalEvidenceBinding} from './canonicalEvidenceBinding';

type Counter=ReturnType<typeof createMappingBudgetBoundary>;
type Status='CONTRADICTED'|'RESOURCE_LIMIT'|'UNSUPPORTED'|'INSUFFICIENT'|'AMBIGUOUS';
// Internal trusted topic registration, not a MappingInput field.
// Fixed event topics in the supplementary fixtures are coordinator-provided.
// No independent Keccak computation or on-chain authentication is asserted.
type Topics={readonly ap:string;readonly rejected:string};
const EMPTY=Object.freeze([]);
const UNCHECKED=Object.freeze([
 Object.freeze({code:'EVIDENCE_BINDING_REMAINING_NOT_ASSESSED',inputRefs:EMPTY}),
 Object.freeze({code:'COMMITMENT_CANONICALITY_FINALITY_NOT_ASSESSED',inputRefs:EMPTY}),
]);
const AUX_FAILURE=Object.freeze({status:'RESOURCE_LIMIT',reasonCode:'BINDING_AUX_LIMIT'} as const);
// 16384 logical control includes descriptors/captures, failure/return envelopes,
// <=16 objects*272, <=8 arrays*144, <=16 fixed strings*392, scalar slots.
// This is logical accounting only, not an engine heap/RSS bound.
// Only R34-owned validated ASCII hex enters. Case-insensitive comparison
// without creating lowercase copies during partial-pair scans.
function knownHexEqual(a:string,b:string):boolean {
 if(a.length!==b.length)return false;
 for(let i=0;i<a.length;i++)if((a.charCodeAt(i)|32)!==(b.charCodeAt(i)|32))return false;
 return true;
}
export function bindNormalEvidence(owned:MappingInput,observationInput:ObservationInput,
 counter:Counter,topics:Topics,deferOrdinaryFailure = false) {
 if(counter.phase!=='ACTIVE')return counter.abortInput(new Error('Binding requires active counter'));
 try{
  if(!counter.reserveAux(16384))return AUX_FAILURE;
  if(!/^0x[0-9a-f]{64}$/.test(topics.ap)||!/^0x[0-9a-f]{64}$/.test(topics.rejected)||topics.ap===topics.rejected)
   throw new Error('Trusted event-topic registration invariant');
  function fail(status:Status,reasonCode:string){
   const result:NonVerifiedResult<'MAPPING'>=Object.freeze({operation:'MAPPING',status,reasonCode,
    diagnostics:EMPTY,versions:owned.scope.versions,checked:EMPTY,unchecked:UNCHECKED,
    inputRefs:EMPTY,provenance:EMPTY,verificationScope:'PROVIDED_EVIDENCE_ONLY',
    canonicality:'NOT_ASSESSED',finality:'NOT_ASSESSED'});
   if (!deferOrdinaryFailure) counter.stopEvidence(result);
   return Object.freeze({status,reasonCode});
  }
  const tx=owned.transaction,receipt=owned.receipt,logs=receipt.logs;
  const count=logs?.length??0;
  // Cumulative Map/Set entries, bounded array slots and wrappers for input
  // context/provenance checks. No logical input is charged a second time.
  const scanReservation=1024+count*2048+owned.sources.length*2048+owned.provenance.length*96;
  if(!Number.isSafeInteger(scanReservation))throw new Error('Binding reservation invariant');
  if(!counter.reserveAux(scanReservation))return AUX_FAILURE;
  let missing=false,conflict:string|null=null;
  function equal(a:unknown,b:unknown,code:string){
   if(a===null||b===null){missing=true;return;}
   const same=typeof a==='string'&&typeof b==='string'?a.toLowerCase()===b.toLowerCase():a===b;
   if(!same&&conflict===null)conflict=code;
  }
  // Fixed keys only; raw getters never enter after R34 ownership.
  equal(tx.hash,receipt.transactionHash,'TRANSACTION_HASH_MISMATCH');
  equal(tx.chainId,owned.scope.expectedChainId,'CHAIN_ID_MISMATCH');
  equal(receipt.chainId,owned.scope.expectedChainId,'CHAIN_ID_MISMATCH');
  equal(tx.blockHash,receipt.blockHash,'BLOCK_HASH_MISMATCH');
  equal(tx.blockNumber,receipt.blockNumber,'BLOCK_NUMBER_MISMATCH');
  equal(tx.transactionIndex,receipt.transactionIndex,'TRANSACTION_INDEX_MISMATCH');
  const indices=new Set<number>();
  if(logs===null)missing=true;
  if(logs)for(const log of logs){
   if(log.logIndex===null)missing=true;
   else if(indices.has(log.logIndex))conflict??='RECEIPT_LOG_INDEX_NOT_UNIQUE';
   else indices.add(log.logIndex);
   equal(log.transactionHash,receipt.transactionHash,'RECEIPT_LOG_CONTEXT_MISMATCH');
   equal(log.chainId,receipt.chainId,'RECEIPT_LOG_CONTEXT_MISMATCH');
   equal(log.blockHash,receipt.blockHash,'RECEIPT_LOG_CONTEXT_MISMATCH');
   equal(log.blockNumber,receipt.blockNumber,'RECEIPT_LOG_CONTEXT_MISMATCH');
   equal(log.transactionIndex,receipt.transactionIndex,'RECEIPT_LOG_CONTEXT_MISMATCH');
   if(log.emitter===null||log.topics===null||log.data===null)missing=true;
  }
  for(const source of owned.sources){
   equal(source.chainId,owned.scope.expectedChainId,'CHAIN_ID_MISMATCH');
   equal(source.transactionHash,tx.hash,'TRANSACTION_HASH_MISMATCH');
   equal(source.blockHash,tx.blockHash,'BLOCK_HASH_MISMATCH');
   equal(source.blockNumber,tx.blockNumber,'BLOCK_NUMBER_MISMATCH');
   equal(source.transactionIndex,tx.transactionIndex,'TRANSACTION_INDEX_MISMATCH');
  }
  const provenanceIds=new Set<string>();
  for(const p of owned.provenance)provenanceIds.add(p.id);
  function references(refs:readonly {readonly id:string}[]){for(const p of refs)if(!provenanceIds.has(p.id))missing=true;}
  references(owned.scope.provenance);references(owned.budget.provenance);
  references(tx.provenance);references(receipt.provenance);
  references(owned.receiptLogCoverage.provenance);references(owned.sourceCoverage.provenance);
  for(const s of owned.sources)references(s.provenance);
  if(conflict)return fail('CONTRADICTED',conflict);
  if(receipt.status===null)missing=true;
  else if(receipt.status!==1)return fail('CONTRADICTED','RECEIPT_NOT_SUCCESSFUL');
  if(tx.capture!=='FULL'||receipt.capture!=='FULL'||owned.receiptLogCoverage.state!=='FULL'||owned.sourceCoverage.state!=='FULL')missing=true;
  // Compare available complete pairs BEFORE completeness/Observation gates.
  // This is not collection completeness: absent/incomplete pairs are skipped,
  // never filled from another record. Existing helper owns content comparison.
  // Extra partial-pair comparison allowance; reserved with the same call.
  let knownReservation=4096+count*(2048+256)+owned.sources.length*(8192+1024);
  for(const source of owned.sources){
   if(source.data!==null)knownReservation+=8*source.data.length;
   if(source.topics!==null)for(const topic of source.topics)knownReservation+=8*topic.length;
  }
  // Receipt strings can be larger than the corresponding Source strings.
  if(logs)for(const log of logs){
   if(log.data!==null)knownReservation+=8*log.data.length;
   if(log.topics!==null)for(const topic of log.topics)knownReservation+=8*topic.length;
  }
  if(!Number.isSafeInteger(knownReservation))throw new Error('Known-pair reservation invariant');
  if(!counter.reserveAux(knownReservation))return AUX_FAILURE;
  // Partial context: SourceIdentity alone locates a supplied occurrence.
  // Each identity component must be known on BOTH sides; parent context is
  // never substituted. Compare only known payload fields, never accept BOUND.
  if(logs!==null)for(const source of owned.sources){
   if(source.chainId===null || source.blockHash===null || source.sourceLogIndex===null)continue;
   const sourceBlockHash=source.blockHash;
   const log=logs.find(l=>l.chainId!==null && l.blockHash!==null && l.logIndex!==null &&
    l.chainId===source.chainId && knownHexEqual(l.blockHash,sourceBlockHash) &&
    l.logIndex===source.sourceLogIndex);
   if(log===undefined)continue;
   const completeHelperPair=tx.data!==null && tx.hash!==null && tx.chainId!==null &&
    tx.blockHash!==null && tx.blockNumber!==null && tx.transactionIndex!==null &&
    receipt.transactionHash!==null && receipt.blockHash!==null &&
    receipt.blockNumber!==null && receipt.transactionIndex!==null &&
    source.blockNumber!==null && source.transactionHash!==null && source.transactionIndex!==null &&
    source.emitter!==null && source.topics!==null && source.data!==null &&
    log.transactionHash!==null && log.transactionIndex!==null && log.blockNumber!==null &&
    log.emitter!==null && log.topics!==null && log.data!==null;
   // Complete pairs stay exclusively with the existing full helper below.
   if(completeHelperPair)continue;
   if(source.emitter!==null && log.emitter!==null &&
      !knownHexEqual(source.emitter,log.emitter))
    return fail('CONTRADICTED','SOURCE_LOG_EMITTER_MISMATCH');
   if(source.topics!==null && log.topics!==null){
    if(source.topics.length!==log.topics.length)
     return fail('CONTRADICTED','SOURCE_LOG_CONTENT_MISMATCH');
    for(let i=0;i<source.topics.length;i++){
     if(!knownHexEqual(source.topics[i],log.topics[i]))
      return fail('CONTRADICTED','SOURCE_LOG_CONTENT_MISMATCH');
    }
   }
   if(source.data!==null && log.data!==null &&
      !knownHexEqual(source.data,log.data))
    return fail('CONTRADICTED','SOURCE_LOG_CONTENT_MISMATCH');
  }
  if(logs!==null && tx.data!==null && tx.hash!==null && tx.chainId!==null &&
     tx.blockHash!==null && tx.blockNumber!==null && tx.transactionIndex!==null &&
     receipt.transactionHash!==null && receipt.blockHash!==null &&
     receipt.blockNumber!==null && receipt.transactionIndex!==null){
   for(const source of owned.sources){
    if(source.chainId===null || source.blockHash===null || source.blockNumber===null ||
       source.transactionHash===null || source.transactionIndex===null || source.sourceLogIndex===null ||
       source.emitter===null || source.topics===null || source.data===null)continue;
    // Index uniqueness was checked above; absence is not inferred as conflict
    // when the supplied set may be incomplete.
    const log=logs.find(l=>l.logIndex===source.sourceLogIndex);
    if(log===undefined || log.logIndex===null || log.transactionHash===null || log.transactionIndex===null ||
       log.blockHash===null || log.blockNumber===null || log.emitter===null ||
       log.topics===null || log.data===null)continue;
    const compared=verifyCanonicalEvidenceBinding({
     source:{chainId:source.chainId,blockHash:source.blockHash,blockNumber:source.blockNumber,
      transactionHash:source.transactionHash,transactionIndex:source.transactionIndex,
      sourceLogIndex:source.sourceLogIndex,emitter:source.emitter,topics:source.topics,eventData:source.data},
     transaction:{hash:tx.hash,chainId:tx.chainId,blockHash:tx.blockHash,
      blockNumber:tx.blockNumber,transactionIndex:tx.transactionIndex,to:tx.to,data:tx.data},
     receipt:{hash:receipt.transactionHash,blockHash:receipt.blockHash,blockNumber:receipt.blockNumber,
      index:receipt.transactionIndex,logs:[{index:log.logIndex,transactionHash:log.transactionHash,
       transactionIndex:log.transactionIndex,blockHash:log.blockHash,blockNumber:log.blockNumber,
       address:log.emitter,topics:log.topics,data:log.data}]},
     expectedChainId:owned.scope.expectedChainId});
    if(compared.status==='CONTRADICTION')return fail('CONTRADICTED',compared.reason);
   }
  }

  // Evaluate known event cardinality before completeness can return INSUFFICIENT.
  // Uses owned, nullable payloads only; never fills context from another record.
  let knownAP = 0, knownRejected = false, knownMixed = false;
  const scopeNormal=owned.scope.normalEmitter, scopeOther=owned.scope.erc1271Emitter;
  if(logs)for(const l of logs){
   if(l.emitter===null || l.topics===null || l.topics.length===0)continue;
   const ap=knownHexEqual(l.topics[0],topics.ap), ar=knownHexEqual(l.topics[0],topics.rejected);
   if(!ap&&!ar)continue;
   if(knownHexEqual(l.emitter,scopeNormal)){if(ap)knownAP++;if(ar)knownRejected=true;}
   else if(scopeOther!==null&&knownHexEqual(l.emitter,scopeOther))knownMixed=true;
  }
  for(const source of owned.sources){
   if(source.emitter===null||source.topics===null||source.topics.length===0)continue;
   const ap=knownHexEqual(source.topics[0],topics.ap),ar=knownHexEqual(source.topics[0],topics.rejected);
   if(!ap&&!ar)continue;
   if(knownHexEqual(source.emitter,scopeNormal)&&ar)knownRejected=true;
   else if(scopeOther!==null&&knownHexEqual(source.emitter,scopeOther))knownMixed=true;
  }
  if(knownRejected)return fail('CONTRADICTED','NORMAL_ACTION_REJECTED_PRESENT');
  if(knownAP>1)return fail('CONTRADICTED','NORMAL_AP_COUNT_NOT_ONE');

  // Observation handles same-identity conflicts, duplicates and provenance
  // recording. No nullable context is filled from another record.
  const gate=counter.observe(observationInput,deferOrdinaryFailure);
  if(gate.kind==='STOP'){
   if(counter.phase==='ACTIVE' && gate.result.status!=='CONTRADICTED' && knownMixed)
    return fail('UNSUPPORTED','NORMAL_MIXED_EVENT_EMITTERS');
   return Object.freeze({status:gate.result.status,reasonCode:gate.result.reasonCode});
  }
  if(knownMixed)return fail('UNSUPPORTED','NORMAL_MIXED_EVENT_EMITTERS');
  const observation=gate.observation;
  if(observation.status!=='VERIFIED')throw new Error('Observation gate invariant');
  if(missing)return fail('INSUFFICIENT','BINDING_CONTEXT_OR_COVERAGE_MISSING');
  if(!logs||tx.hash===null||tx.chainId===null||tx.blockHash===null||tx.blockNumber===null||tx.transactionIndex===null)
   throw new Error('Binding complete-context invariant');
  if(tx.to===null)return fail('INSUFFICIENT','TRANSACTION_TARGET_MISSING');
  if(tx.to.toLowerCase()!==owned.scope.normalEmitter.toLowerCase())return fail('UNSUPPORTED','TRANSACTION_TARGET_UNSUPPORTED');

  // Reserve helper upper bound BEFORE lower-case event scans and wrappers:
  // <=2048 per receipt log for fixed hex comparisons, .filter arrays/Set;
  // <=8192 per source plus 8*data.length and 8*sum(topic.length).
  // Covers cumulative lower-case string occurrences for existing helper calls.
  let helperReservation=4096+logs.length*2048+observation.observations.length*8192;
  for(const s of observation.observations){
   helperReservation+=8*s.data.length;
   for(const t of s.topics)helperReservation+=8*t.length;
  }
  if(!Number.isSafeInteger(helperReservation))throw new Error('Helper reservation invariant');
  if(!counter.reserveAux(helperReservation))return AUX_FAILURE;
  const normal=owned.scope.normalEmitter.toLowerCase(),other=owned.scope.erc1271Emitter?.toLowerCase();
  let apCount=0,rejectedCount=0,mixed=false;
  for(const l of logs){
   const emitter=l.emitter!.toLowerCase(),topic=l.topics![0]?.toLowerCase();
   if(topic===topics.ap||topic===topics.rejected){
    if(emitter===normal){if(topic===topics.ap)apCount++;else rejectedCount++;}
    else if(other!==undefined&&emitter===other)mixed=true;
   }
  }
  // Content matching is delegated to the existing helper, not reimplemented.
  // Only AP sources feed the AP helper; duplicate acquisitions are normalized.
  const sources=[];
  for(const s of observation.observations){
   const e=s.emitter.toLowerCase(),t=s.topics[0]?.toLowerCase();
   if(other!==undefined&&e===other&&(t===topics.ap||t===topics.rejected))mixed=true;
   if(e===normal&&t===topics.rejected)rejectedCount++;
   if(e===normal&&t===topics.ap)sources.push({chainId:s.identity.chainId,
    blockNumber:s.blockNumber,blockHash:s.identity.blockHash,transactionHash:s.transactionHash,
    transactionIndex:s.transactionIndex,sourceLogIndex:s.identity.sourceLogIndex,
    emitter:s.emitter,topics:s.topics,eventData:s.data});
  }
  if(rejectedCount>0)return fail('CONTRADICTED','NORMAL_ACTION_REJECTED_PRESENT');
  if(mixed)return fail('UNSUPPORTED','NORMAL_MIXED_EVENT_EMITTERS');
  if(apCount>1)return fail('CONTRADICTED','NORMAL_AP_COUNT_NOT_ONE');
  if(apCount===0)return fail('INSUFFICIENT','NORMAL_AP_MISSING');
  const helperLogs=logs.map(l=>({index:l.logIndex!,transactionHash:l.transactionHash!,
   transactionIndex:l.transactionIndex!,blockHash:l.blockHash!,blockNumber:l.blockNumber!,
   address:l.emitter!,topics:l.topics!,data:l.data!}));
  const bound=verifyReceiptEvidenceSet({sources,
   transaction:{hash:tx.hash,chainId:tx.chainId,blockNumber:tx.blockNumber,blockHash:tx.blockHash,
    transactionIndex:tx.transactionIndex,to:tx.to,data:tx.data??''},
   receipt:{hash:receipt.transactionHash!,blockNumber:receipt.blockNumber!,blockHash:receipt.blockHash!,index:receipt.transactionIndex!,logs:helperLogs},
   expectedChainId:owned.scope.expectedChainId,expectedEmitter:owned.scope.normalEmitter,expectedTopic:topics.ap});
  if(bound.status!=='VERIFIED')return fail(bound.status==='CONTRADICTION'?'CONTRADICTED':'INSUFFICIENT',bound.reason);
  // No per-action Source copies, no ordinal->logIndex arithmetic.
  return Object.freeze({status:'BOUND' as const,reasonCode:'NORMAL_EVIDENCE_BOUND',
   sourceIdentity:observation.observations.find(s=>s.emitter.toLowerCase()===normal&&s.topics[0]?.toLowerCase()===topics.ap)!.identity,
   apCount:1,rejectedCount:0,verificationScope:'PROVIDED_EVIDENCE_ONLY',
   canonicality:'NOT_ASSESSED',finality:'NOT_ASSESSED'});
 }catch(error:unknown){return counter.abortInput(error);}
}

/** Internal known-pair selection after a nonterminal Binding result.
 * Does NOT establish BOUND or fill missing Source fields. Used only to check
 * independently comparable commitment values before final INSUFFICIENT.
 * Transaction-to-receipt/log identity must itself be known and equal.
 */
export function knownNormalAPForComparison(owned:MappingInput, counter:Counter, topics:Topics) {
 if(counter.phase!=='ACTIVE')throw new Error('Known commitment comparison requires active counter');
 if(!counter.reserveAux(512))return Object.freeze({status:'RESOURCE_LIMIT',reasonCode:'KNOWN_AP_AUX_LIMIT'} as const);
 const tx=owned.transaction,r=owned.receipt;
 if(tx.to===null||!knownHexEqual(tx.to,owned.scope.normalEmitter))return null;
 if(tx.hash===null||tx.chainId===null||tx.blockHash===null||r.transactionHash===null||r.chainId===null||r.blockHash===null||r.logs===null)return null;
 if(!knownHexEqual(tx.hash,r.transactionHash)||tx.chainId!==r.chainId||!knownHexEqual(tx.blockHash,r.blockHash))return null;
 let candidate:MappingInput['sources'][number]|null=null;
 for(const log of r.logs){
  if(log.logIndex===null||log.chainId!==tx.chainId||log.blockHash===null||!knownHexEqual(log.blockHash,tx.blockHash)||
     log.transactionHash===null||!knownHexEqual(log.transactionHash,tx.hash)||log.emitter===null||
     !knownHexEqual(log.emitter,owned.scope.normalEmitter)||log.topics===null||log.topics.length===0||
     !knownHexEqual(log.topics[0],topics.ap)||log.data===null)continue;
  for(const source of owned.sources){
   if(source.chainId!==log.chainId||source.blockHash===null||!knownHexEqual(source.blockHash,log.blockHash)||
      source.sourceLogIndex!==log.logIndex||source.emitter===null||!knownHexEqual(source.emitter,log.emitter)||
      source.topics===null||source.topics.length===0||!knownHexEqual(source.topics[0],topics.ap)||source.data===null)continue;
   if(candidate!==null&&(candidate.sourceLogIndex!==source.sourceLogIndex||candidate.chainId!==source.chainId||
      candidate.blockHash===null||!knownHexEqual(candidate.blockHash,source.blockHash)))return null;
   candidate=source;
  }
 }
 if(candidate===null||candidate.chainId===null||candidate.blockHash===null||candidate.sourceLogIndex===null)return null;
 return Object.freeze({status:'KNOWN_PAIR' as const,sourceIdentity:Object.freeze({
  chainId:candidate.chainId,blockHash:candidate.blockHash,sourceLogIndex:candidate.sourceLogIndex})});
}
