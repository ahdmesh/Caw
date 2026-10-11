/** Internal orchestration. Only mapping.ts is the public entrypoint.
 * Dependencies below are module-owned in production, not caller input.
 */
import type {
  MappingInput, NormalMappingResult, NonVerifiedResult, NonVerifiedStatus,
  ResultMetadata, InputReference, AssessmentRange, Diagnostic, SourceReference,
  SuccessfulActionMapping, SuccessfulGroupMapping, NonEmptyReadonlyArray,
  NormalMappingPayload, Hash32, ReceiptIdentity, CallPath,
} from './types';
import { createMappingBudgetBoundary } from './mappingBudget';
import { copyMappingInput } from './mappingInput';
import { bindNormalEvidence, knownNormalAPForComparison } from './evidenceBinding';
import { decodeNormalAbi } from './normalAbi';
import { associateNormalActions } from './association';
import { parseStrictActionBatch, PackedActionFormatError } from './action';
import { checkNormalCommitment } from './normalCommitment';

const TOPICS=Object.freeze({
  ap:'0xd546c3e1b2cc91bad7dbdf7a2152244afd0b547288e352b479b64d83bda1c59d',
  rejected:'0xec56a08d611053c4998936acc2a5a9474184899d68dc5ca286b3da697e1a1d4a',
});
const EMPTY=Object.freeze([]);
const SCOPE=Object.freeze({verificationScope:'PROVIDED_EVIDENCE_ONLY',canonicality:'NOT_ASSESSED',finality:'NOT_ASSESSED'} as const);
const LIMITS=Object.freeze([
  Object.freeze({code:'CANONICALITY_FINALITY_NOT_ASSESSED',inputRefs:EMPTY}),
  Object.freeze({code:'CRYPTOGRAPHIC_SIGNATURE_AND_CHAIN_EXECUTION_NOT_ASSESSED',inputRefs:EMPTY}),
  Object.freeze({code:'R37_LOGICAL_LIBRARY_ALLOCATION_BOUND_UNPROVEN',inputRefs:EMPTY}),
]);
const EARLY:NonVerifiedResult<'MAPPING'>=Object.freeze({
  operation:'MAPPING',status:'RESOURCE_LIMIT',reasonCode:'NORMAL_RESULT_CONTROL_DENIED',
  diagnostics:EMPTY,versions:Object.freeze({abi:'',rules:'',budget:''}),checked:EMPTY,
  unchecked:Object.freeze([...LIMITS,Object.freeze({code:'REMAINING_VALIDATION_NOT_ASSESSED',inputRefs:EMPTY}),
    Object.freeze({code:'PROFILE_VERSIONS_UNAVAILABLE_EMPTY_PLACEHOLDERS',inputRefs:EMPTY})]),
  inputRefs:EMPTY,provenance:EMPTY,...SCOPE,
});
const RANK:Readonly<Record<NonVerifiedStatus,number>>=Object.freeze({
  CONTRADICTED:0,RESOURCE_LIMIT:1,UNSUPPORTED:2,INSUFFICIENT:3,AMBIGUOUS:4,
});
// Logical fixed envelope, not a heap bound. <=64 scalar/capture slots (1024),
// <=32 objects of <=16 fields (8704), <=16 arrays of <=32 slots (4352),
// <=4 short generated strings of <=128 UTF-16 units (1056): total 15136.
// Long refs, per-action/group output, Observation metadata are separately charged.
const RESULT_CONTROL=16384;
type Failure={readonly status:NonVerifiedStatus;readonly reasonCode:string};

// Internal test seam only. index.ts exports none of these dependencies.
export const normalDependencies=Object.freeze({
  createCounter:createMappingBudgetBoundary,
  parseActions:parseStrictActionBatch,
  commitment:checkNormalCommitment,
});
type Dependencies=typeof normalDependencies;

function nonempty<T>(items:readonly T[]):NonEmptyReadonlyArray<T> {
  if(items.length===0)throw new Error('NORMAL successful collection invariant');
  return items as NonEmptyReadonlyArray<T>;
}

export function runNormal(input:MappingInput,deps:Dependencies):NormalMappingResult {
  const counter=deps.createCounter();
  try {
    if(!counter.reserveAux(RESULT_CONTROL))return counter.stopInput(EARLY);
    const copied=copyMappingInput(input,counter);
    if(!('kind' in copied))return copied;
    const owned=copied.owned;
    // Save immutable references before any possible denial; no later raw reads.
    const versions=owned.scope.versions, provenance=owned.provenance;
    const refCount=6+owned.sources.length;
    if(!counter.reserveAux(16+8*refCount)){
      return counter.stopEvidence(Object.freeze({...EARLY,versions,provenance}));
    }
    const inputRefs:InputReference[]=[owned.scope.inputRef,owned.budget.inputRef,
      owned.transaction.inputRef,owned.receipt.inputRef,
      owned.receiptLogCoverage.inputRef,owned.sourceCoverage.inputRef];
    for(const source of owned.sources)inputRefs.push(source.inputRef);
    Object.freeze(inputRefs);
    let bindingChecked=false, abiChecked=false, associationChecked=false, commitmentChecked=false;
    let selected:Failure|null=null;
    const findings:Failure[]=[]; // <=4 stage failures; fixed control above
    function record(f:Failure):void {
      findings.push(f);
      if(selected===null||RANK[f.status]<RANK[selected.status])selected=f;
    }
    function metadata(reasonCode:string):ResultMetadata {
      // Reads only previously built metadata, never raw or unvisited evidence.
      const observation=counter.observationResult;
      const checked:AssessmentRange[]=[Object.freeze({code:'MAPPING_INPUT_SCHEMA_PROFILE_AND_LOGICAL_COUNT',inputRefs})];
      const unchecked:AssessmentRange[]=[...LIMITS];
      // Retain the original Observation checks and missing/stop ranges.
      // Array slots <=32 per list; Observation emits bounded range lists.
      if(observation){
        for(const range of observation.checked)checked.push(range);
        for(const range of observation.unchecked){
          // Superseded by the four integrated stage ranges below. Keeping this
          // Observation-only label would falsely say commitment was unchecked.
          if(range.code!=='RECEIPT_MAPPING_COMMITMENT_NOT_ASSESSED')unchecked.push(range);
        }
      }
      for(const [ok,name] of [[bindingChecked,'TRANSACTION_RECEIPT_SOURCE_BINDING'],
        [abiChecked,'NORMAL_ABI'],[associationChecked,'NORMAL_ASSOCIATION'],
        [commitmentChecked,'NORMAL_AP_COMMITMENT']] as const){
        (ok?checked:unchecked).push(Object.freeze({code:name+(ok?'_ESTABLISHED':'_NOT_ESTABLISHED'),inputRefs}));
      }
      if(counter.phase==='STOPPED'||counter.sharedRejected)
        unchecked.push(Object.freeze({code:'REMAINING_VALIDATION_NOT_ASSESSED',inputRefs}));
      const diagnostics:Diagnostic[]=[];
      // Put the selected result first; preserve all original diagnostics up to cap.
      diagnostics.push(Object.freeze({reasonCode,message:reasonCode,inputRefs,sourceRefs:EMPTY}));
      if(observation){
        for(const d of observation.diagnostics)if(d.reasonCode==='OBSERVATION_ACCOUNTING')diagnostics.push(d);
        for(const d of observation.diagnostics){
          if(d.reasonCode==='OBSERVATION_ACCOUNTING')continue;
          if(diagnostics.length===32){unchecked.push(Object.freeze({code:'INTEGRATION_DIAGNOSTICS_TRUNCATED',inputRefs}));break;}
          diagnostics.push(d);
        }
      }
      for(const f of findings){if(diagnostics.length===32)break;
        if(f.reasonCode!==reasonCode)diagnostics.push(Object.freeze({reasonCode:f.reasonCode,message:f.reasonCode,inputRefs,sourceRefs:EMPTY}));
      }
      return Object.freeze({reasonCode,diagnostics:Object.freeze(diagnostics),versions,
        checked:Object.freeze(checked),unchecked:Object.freeze(unchecked),inputRefs,provenance,...SCOPE});
    }
    function finishFailure(f:Failure):NonVerifiedResult<'MAPPING'> {
      const result=Object.freeze({operation:'MAPPING' as const,status:f.status,...metadata(f.reasonCode)});
      return counter.stopEvidence(result);
    }
    function mustStop():boolean {
      return counter.phase!=='ACTIVE'||counter.sharedRejected||selected?.status==='CONTRADICTED'||selected?.status==='RESOURCE_LIMIT';
    }
    // Ordinary lack of evidence is provisional. A resource stop is terminal.
    // Binding first keeps comparable known payload conflicts visible even when
    // calldata or unrelated context is missing. No new pair is inferred.
    const bound=bindNormalEvidence(owned,copied.observationInput,counter,TOPICS,true);
    if(bound.status==='BOUND')bindingChecked=true;
    else record(bound);
    if(mustStop())return finishFailure(selected!);

    const abi=decodeNormalAbi(owned,counter,true);
    if(abi.status!=='DECODED'){
      record(abi);
      return finishFailure(selected!);
    }
    abiChecked=true;
    // One consumer; the strict action parser is called once and its output reused.
    return abi.consumeOwned((packed,sigs):NormalMappingResult=>{
      let association:ReturnType<typeof associateNormalActions>;
      try {
        association=associateNormalActions(packed,sigs,owned.transaction.capture,owned.budget,
          n=>counter.reserveAux(n),deps.parseActions);
      } catch(error:unknown) {
        if(!(error instanceof PackedActionFormatError))throw error;
        record({status:'CONTRADICTED',reasonCode:error.reasonCode});
        return finishFailure(selected!);
      }
      if(association.status!=='ASSOCIATED'){
        record(association);return finishFailure(selected!);
      }
      associationChecked=true;
      // Completeness must not hide a mismatch in otherwise comparable AP values.
      // A KNOWN_PAIR can only reject/confirm those values; it can never permit
      // public VERIFIED without the original independent BOUND result.
      const commitmentSource=bound.status==='BOUND'?bound:knownNormalAPForComparison(owned,counter,TOPICS);
      if(commitmentSource===null)return finishFailure(selected!);
      if(commitmentSource.status==='RESOURCE_LIMIT'){record(commitmentSource);return finishFailure(selected!);}
      const commitment=deps.commitment(owned,commitmentSource,abi.metadata,association,packed,counter);
      if(commitment.status!=='COMMITMENT_MATCHED'){
        record(commitment);return finishFailure(selected!);
      }
      commitmentChecked=true;
      if(bound.status!=='BOUND')return finishFailure(selected!);
      if(counter.phase!=='ACTIVE'||counter.sharedRejected)throw new Error('NORMAL terminal counter invariant');
      const observation=counter.observationResult;
      if(observation?.status!=='VERIFIED')throw new Error('NORMAL Observation invariant');
      const source=observation.observations.find(o=>
        o.identity.chainId===bound.sourceIdentity.chainId && o.identity.blockHash===bound.sourceIdentity.blockHash &&
        o.identity.sourceLogIndex===bound.sourceIdentity.sourceLogIndex);
      if(!source)throw new Error('NORMAL source reference invariant');
      // Reserve before all final identities/arrays/objects. Existing frozen
      // source refs, provenance and strings are referenced, never recopied.
      // Per action 512 covers identity64 + mapping80 + group-array slot8 +
      // flat-array slot8; per group384 covers identity64 + mapping80 + arrays.
      const outputBytes=4096+association.actionCount*512+association.groups.length*384;
      if(!counter.reserveAux(outputBytes))return finishFailure({status:'RESOURCE_LIMIT',reasonCode:'NORMAL_OUTPUT_AUX_LIMIT'});
      const receiptIdentity:ReceiptIdentity=Object.freeze({chainId:source.identity.chainId,
        blockHash:source.identity.blockHash,transactionIndex:source.transactionIndex});
      // Direct top-level transaction call: empty path, no invented nested frame.
      const callPath:CallPath=EMPTY;
      const reference:SourceReference=Object.freeze({identity:source.identity,inputRefs:source.inputRefs,provenance:source.provenance});
      const sources=Object.freeze([reference]);
      const actions:SuccessfulActionMapping[]=[],groups:SuccessfulGroupMapping[]=[];
      for(const group of association.groups){
        const identity=Object.freeze({receipt:receiptIdentity,callPath,groupOrdinal:group.groupOrdinal});
        const groupActions:SuccessfulActionMapping[]=[];
        for(const action of group.actions){
          const mapped:SuccessfulActionMapping=Object.freeze({
            identity:Object.freeze({receipt:receiptIdentity,callPath,actionOrdinal:action.actionOrdinal}),
            group:identity,groupActionOrdinal:action.groupActionOrdinal,outcome:'SUCCESS',source:reference});
          groupActions.push(mapped);actions.push(mapped);
        }
        groups.push(Object.freeze({identity,outcome:'SUCCESS',actions:nonempty(Object.freeze(groupActions)),sources}));
      }
      const allActions=nonempty(Object.freeze(actions));
      const event=Object.freeze({event:reference,group:null,actionCount:commitment.actionCount,batchHash:commitment.batchHash as Hash32});
      const mapping:NormalMappingPayload=Object.freeze({profile:'NORMAL',outcomeKind:'HAS_SUCCESS',
        receiptIdentity,callPath,sourceCorrespondence:sources,groups:nonempty(Object.freeze(groups)),
        actions:allActions,successfulActions:allActions,successfulActionCount:association.actionCount,
        commitment:Object.freeze({status:'VERIFIED',events:Object.freeze([event] as const)})});
      return Object.freeze({operation:'MAPPING',status:'VERIFIED',mapping,...metadata('NORMAL_MAPPING_VERIFIED')});
    });
  }catch(error:unknown){return counter.abortInput(error);}
}
