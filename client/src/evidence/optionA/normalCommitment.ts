import { Interface, keccak256 } from 'ethers';
import type {MappingInput, NonVerifiedResult, SourceIdentity} from './types';
import type {createMappingBudgetBoundary} from './mappingBudget';

// Internal trusted connection only. No public barrel export or Mapping VERIFIED.
// R34-owned input; actual R35/R27/R36 results from this same invocation.
// KNOWN_PAIR is internal partial evidence, never equivalent to BOUND.
// No arbitrary caller-supplied decoded commitment is accepted.
type Counter = ReturnType<typeof createMappingBudgetBoundary>;
type Bound = {readonly status:'BOUND';readonly sourceIdentity:SourceIdentity;readonly apCount:number;readonly rejectedCount:number};
type KnownPair = {readonly status:'KNOWN_PAIR';readonly sourceIdentity:SourceIdentity};
type Association = {readonly status:'ASSOCIATED';readonly networkId:number;readonly actionCount:number;readonly packedConsumedBytes:number};
const TOPIC='0xd546c3e1b2cc91bad7dbdf7a2152244afd0b547288e352b479b64d83bda1c59d';
const AP=new Interface(['event ActionsProcessed(uint32 indexed networkId, uint32 indexed validatorId, uint16 actionCount, bytes32 batchHash)']);
const EMPTY=Object.freeze([]);
const UNCHECKED=Object.freeze([Object.freeze({code:'MAPPING_CANONICALITY_FINALITY_NOT_ASSESSED',inputRefs:EMPTY}),Object.freeze({code:'LIBRARY_ALLOCATION_BOUND_NOT_PROVEN',inputRefs:EMPTY})]);
const AUX_FAILURE=Object.freeze({status:'RESOURCE_LIMIT',reasonCode:'COMMITMENT_AUX_LIMIT'} as const);
// Existing logical units; caller-side envelope only. This is NOT an upper bound
// for Interface/AbiCoder/Keccak library internals. Hence overall CONDITIONAL.
// metadata208 + failure48 + success176 + identity64 + decode input64 +
// 64 scalar/capture slots1024 + eight <=66-code-unit strings1120 + three uint32 bigint values36 + topics array40.
export const CALLER_RESERVATION=2780;
export function checkNormalCommitment(owned:MappingInput,bound:Bound|KnownPair,
 abi:{readonly validatorId:number},association:Association,packed:Uint8Array,counter:Counter) {
 if(counter.phase!=='ACTIVE'||counter.sharedRejected)return counter.abortInput(new Error('Commitment inactive counter'));
 try {
  if(!counter.reserveAux(CALLER_RESERVATION))return AUX_FAILURE;
  function fail(status:'CONTRADICTED'|'INSUFFICIENT'|'UNSUPPORTED',reasonCode:string){
   const result:NonVerifiedResult<'MAPPING'>=Object.freeze({operation:'MAPPING',status,reasonCode,
    diagnostics:EMPTY,versions:owned.scope.versions,checked:EMPTY,unchecked:UNCHECKED,
    inputRefs:EMPTY,provenance:EMPTY,verificationScope:'PROVIDED_EVIDENCE_ONLY',canonicality:'NOT_ASSESSED',finality:'NOT_ASSESSED'});
   counter.stopEvidence(result);return Object.freeze({status,reasonCode});
  }
  if(association.status!=='ASSOCIATED'||
    (bound.status==='BOUND'&&(bound.apCount!==1||bound.rejectedCount!==0)))
   throw new Error('Trusted prerequisite result invariant');
  if(association.packedConsumedBytes!==packed.length)throw new Error('Owned packed extent invariant');
  const id=bound.sourceIdentity,logs=owned.receipt.logs;
  if(logs===null)return fail('INSUFFICIENT','COMMITMENT_AP_LOG_MISSING');
  let log:NonNullable<MappingInput['receipt']['logs']>[number]|undefined;
  for(const candidate of logs)if(candidate.logIndex===id.sourceLogIndex){log=candidate;break;}
  if(log===undefined)return fail('INSUFFICIENT','COMMITMENT_AP_LOG_MISSING');
  if(log.chainId===null||log.blockHash===null)return fail('INSUFFICIENT','COMMITMENT_IDENTITY_MISSING');
  if(log.chainId!==id.chainId||log.blockHash.toLowerCase()!==id.blockHash.toLowerCase())
   return fail('CONTRADICTED','COMMITMENT_SOURCE_IDENTITY_MISMATCH');
  if(log.emitter===null||log.topics===null||log.data===null)return fail('INSUFFICIENT','COMMITMENT_AP_PAYLOAD_MISSING');
  if(log.emitter.toLowerCase()!==owned.scope.normalEmitter.toLowerCase())
   return fail('UNSUPPORTED','COMMITMENT_EMITTER_UNSUPPORTED');
  if(log.topics.length!==3||log.topics[0].toLowerCase()!==TOPIC)
   return fail('UNSUPPORTED','COMMITMENT_EVENT_TOPIC_UNSUPPORTED');
  // Bounded, canonical event representation for this limited adapter; a
  // noncanonical encoding is UNSUPPORTED, not a claim of Solidity revert.
  if(log.data.length!==130||!/^0x[0-9a-fA-F]{128}$/.test(log.data)||
    !/^0x0{56}[0-9a-fA-F]{8}$/.test(log.topics[1])||
    !/^0x0{56}[0-9a-fA-F]{8}$/.test(log.topics[2])||
    !/^0{60}[0-9a-fA-F]{4}$/.test(log.data.slice(2,66)))
   return fail('UNSUPPORTED','COMMITMENT_EVENT_ENCODING_UNSUPPORTED');
  // Additional caller reservation precedes allocating the decode input array.
  // No hidden encompassing catch in the old helper: every thrown exception
  // here propagates via abortInput; no Error.message based classification.
  const decoded=AP.decodeEventLog('ActionsProcessed',log.data,[...log.topics]);
  const network=decoded.networkId,validator=decoded.validatorId,count=decoded.actionCount;
  if(typeof network!=='bigint'||typeof validator!=='bigint'||typeof count!=='bigint'||typeof decoded.batchHash!=='string')
   throw new Error('ABI decode dependency invariant');
  if(validator!==BigInt(abi.validatorId))return fail('CONTRADICTED','COMMITMENT_VALIDATOR_ID_MISMATCH');
  if(network!==BigInt(association.networkId))return fail('CONTRADICTED','COMMITMENT_NETWORK_ID_MISMATCH');
  if(count!==BigInt(association.actionCount))return fail('CONTRADICTED','COMMITMENT_ACTION_COUNT_MISMATCH');
  // Same owned bytes, including action-count prefix. No getBytes(), no action
  // reparsing, no signature verification, no additional packed byte copy here.
  const actual=keccak256(packed);
  if(actual!==decoded.batchHash)return fail('CONTRADICTED','COMMITMENT_BATCH_HASH_MISMATCH');
  return Object.freeze({status:'COMMITMENT_MATCHED' as const,reasonCode:'NORMAL_COMMITMENT_MATCHED',
   sourceIdentity:Object.freeze({chainId:id.chainId,blockHash:id.blockHash,sourceLogIndex:id.sourceLogIndex}),
   validatorId:abi.validatorId,networkId:association.networkId,actionCount:association.actionCount,
   batchHash:actual,verificationScope:'PROVIDED_EVIDENCE_ONLY',canonicality:'NOT_ASSESSED',finality:'NOT_ASSESSED'});
 }catch(error:unknown){return counter.abortInput(error);}
}
