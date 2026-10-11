import type {MappingInput, ObservationInput, NonVerifiedResult, ProfileVersions} from './types';
import {matchProfile} from './profile';
import {createMappingBudgetBoundary} from './mappingBudget';

// Internal Mapping-only closed schema. No public API/barrel changes.
// Ordinary data objects/arrays only; arbitrary Proxy and modified built-ins
// are outside the same trust boundary as Observation. Unknown keys ignored.
const INPUT_LIMIT=8388608;
const INPUT_CONTROL=8192;
// Per call: <=32 scalar/capture slots (512), <=16 bounded descriptor/stack
// frames at 256 (4096), <=8 envelope/diagnostic objects at 208 (1664),
// <=8 short arrays at 80 (640), <=3 generated strings at 392 (1176).
// Sum 8088. Recursive schema depth <16. No per-element descriptor retention.
// Dynamic copies/arrays/bigint thresholds are charged separately.
// This is logical storage, not engine stack/heap/RSS.
const EMPTY=Object.freeze([]);
const STOP=Object.freeze({});
const UNKNOWN_VERSIONS=Object.freeze({abi:'',rules:'',budget:''});
const EARLY:NonVerifiedResult<'MAPPING'>=Object.freeze({
 operation:'MAPPING',status:'RESOURCE_LIMIT',reasonCode:'MAPPING_INPUT_CONTROL_DENIED',
 diagnostics:Object.freeze([Object.freeze({reasonCode:'MAPPING_INPUT_CONTROL_DENIED',message:'MAPPING_INPUT_CONTROL_DENIED',inputRefs:EMPTY,sourceRefs:EMPTY})]),
 versions:UNKNOWN_VERSIONS,checked:EMPTY,
 unchecked:Object.freeze([Object.freeze({code:'REMAINING_VALIDATION_NOT_ASSESSED',inputRefs:EMPTY}),Object.freeze({code:'PROFILE_VERSIONS_UNAVAILABLE_EMPTY_PLACEHOLDERS',inputRefs:EMPTY})]),
 inputRefs:EMPTY,provenance:EMPTY,verificationScope:'PROVIDED_EVIDENCE_ONLY',canonicality:'NOT_ASSESSED',finality:'NOT_ASSESSED',
});
type Counter=ReturnType<typeof createMappingBudgetBoundary>;
type Schema=string|{readonly item:Schema;readonly max?:number;readonly nullable?:boolean}|{readonly fields:readonly (readonly [string,Schema])[]};
const ref=(kind:string):Schema=>({fields:[['kind','='+kind],['id','nonempty']]});
const refs:Schema={item:{fields:[['id','nonempty']]}};
const versions:Schema={fields:[['abi','string'],['rules','string'],['budget','string']]};
const scope:Schema={fields:[['inputRef',ref('SCOPE')],['expectedChainId','positive'],['normalEmitter','address'],['erc1271Emitter','?address'],['versions',versions],['provenance',refs]]};
const budget:Schema={fields:[['inputRef',ref('BUDGET')],['version','string'],
 ['maxCalldataBytes','ordinal'],['maxPackedActionBytes','ordinal'],['maxLogicalInputBytes','ordinal'],
 ['maxReceiptLogs','ordinal'],['maxSourceRecords','ordinal'],['maxLogTopics','ordinal'],
 ['maxNormalSafeActions','ordinal'],['maxNormalSafeGroups','ordinal'],['maxERC1271Groups','ordinal'],
 ['maxERC1271Actions','ordinal'],['maxERC1271GroupSize','ordinal'],['maxSafeDPStates','ordinal'],
 ['maxSafeDPWorkUnits','ordinal'],['maxReasonByteComparisons','ordinal'],['maxAuxiliaryBufferBytes','ordinal'],['maxDiagnostics','ordinal'],['provenance',refs]]};
const topics:Schema={item:'hash',max:4,nullable:true};
const source:Schema={fields:[['inputRef',ref('SOURCE')],['chainId','?positive'],['blockHash','?hash'],['blockNumber','?bigint'],['transactionHash','?hash'],['transactionIndex','?ordinal'],['sourceLogIndex','?ordinal'],['emitter','?address'],['topics',topics],['data','?hex'],['provenance',refs]]};
const transaction:Schema={fields:[['inputRef',ref('TRANSACTION')],['hash','?hash'],['chainId','?positive'],['blockHash','?hash'],['blockNumber','?bigint'],['transactionIndex','?ordinal'],['to','?address'],['data','?calldata'],['capture','capture'],['provenance',refs]]};
const log:Schema={fields:[['logIndex','?ordinal'],['transactionHash','?hash'],['chainId','?positive'],['blockHash','?hash'],['blockNumber','?bigint'],['transactionIndex','?ordinal'],['emitter','?address'],['topics',topics],['data','?hex']]};
const receipt:Schema={fields:[['inputRef',ref('RECEIPT')],['transactionHash','?hash'],['chainId','?positive'],['blockHash','?hash'],['blockNumber','?bigint'],['transactionIndex','?ordinal'],['status','?receiptStatus'],['logs',{item:log,max:4096,nullable:true}],['capture','capture'],['provenance',refs]]};
const coverage:Schema={fields:[['inputRef',ref('COVERAGE')],['state','capture'],['provenance',refs]]};
const provenance:Schema={fields:[['id','nonempty'],['method','nonempty'],['provider','nonempty'],['acquisitionScope','nonempty'],['capture','capture'],['captureTime','?string'],['description','?string']]};
const root:Schema={fields:[['scope',scope],['budget',budget],['transaction',transaction],['receipt',receipt],['sources',{item:source,max:4096}],['receiptLogCoverage',coverage],['sourceCoverage',coverage],['provenance',{item:provenance}]]};

/** Completes ownership before Observation; no binding/decoding/Mapping success.
 * Every schema occurrence counts, even repeated references to the same object.
 * Scalar immutable values may be shared; all mutable containers are new.
 */
export function copyMappingInput(raw:unknown,counter:Counter) {
 // A boundary owns one Mapping call. Do not pass a stopped/reused counter.
 if(counter.phase!=='ACTIVE')return counter.abortInput(new Error('Input boundary requires active counter'));
 try {
  if(!counter.reserveAux(INPUT_CONTROL))return counter.stopInput(EARLY);
 }catch(error:unknown){return counter.abortInput(error);}
 let inputBytes=0;
 let complete=false;
 let acquired:ProfileVersions=UNKNOWN_VERSIONS;
 let failure:'CONTRADICTED'|'RESOURCE_LIMIT'|'UNSUPPORTED'='CONTRADICTED';
 let reason='MAPPING_INPUT_INVALID';
 function stop(status:typeof failure,code:string):never{failure=status;reason=code;throw STOP;}
 function charge(n:number){
  if(!Number.isSafeInteger(n)||n<0)throw new Error('Logical counter invariant');
  if(n>INPUT_LIMIT-inputBytes)stop('RESOURCE_LIMIT','INPUT_BUDGET_EXCEEDED');
  inputBytes+=n;
 }
 function reserve(n:number){if(!counter.reserveAux(n))stop('RESOURCE_LIMIT','AUXILIARY_BUDGET_EXCEEDED');}
 function own(v:object,k:string){const d=Object.getOwnPropertyDescriptor(v,k);if(!d||!('value'in d))stop('CONTRADICTED','REQUIRED_DATA_PROPERTY_INVALID');return d.value;}
 function text(s:string){
  charge(5);if(s.length>INPUT_LIMIT-inputBytes)stop('RESOURCE_LIMIT','INPUT_BUDGET_EXCEEDED');
  for(let i=0;i<s.length;i++){
   const c=s.charCodeAt(i);
   if(c<=127)charge(1);else if(c<=2047)charge(2);
   else if(c>=0xd800&&c<=0xdbff&&i+1<s.length&&s.charCodeAt(i+1)>=0xdc00&&s.charCodeAt(i+1)<=0xdfff){charge(4);i++;}
   else charge(3);
  }
 }
 function magnitude(v:bigint){
  charge(6);if(v===0n)return 0;
  const available=INPUT_LIMIT-inputBytes;if(available===0)stop('RESOURCE_LIMIT','INPUT_BUDGET_EXCEEDED');
  function threshold(n:number){reserve(32+n+1);return 1n<<BigInt(n*8);}
  let lo=0,hi=1;
  while(v>=threshold(hi)){lo=hi;if(hi===available)stop('RESOURCE_LIMIT','INPUT_BUDGET_EXCEEDED');hi=Math.min(available,hi*2);}
  while(hi-lo>1){const mid=lo+Math.floor((hi-lo)/2);if(v<threshold(mid))hi=mid;else lo=mid;}
  charge(hi);return hi;
 }
 function copy(v:unknown,s:Schema):unknown{
  if(typeof s==='string'){
   if(s.charCodeAt(0)===63){if(v===null){charge(1);return null;}s=s.slice(1);}
   if(s==='positive'||s==='bigint'){
    if(typeof v!=='bigint'||v<0n||(s==='positive'&&v===0n))stop('CONTRADICTED','BIGINT_RANGE_INVALID');
    const bytes=magnitude(v);reserve(8+bytes);return v;
   }
   if(s==='ordinal'||s==='receiptStatus'){
    if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||(s==='receiptStatus'&&v!==0&&v!==1))stop('CONTRADICTED','NUMBER_RANGE_INVALID');
    charge(9);return v;
   }
   if(typeof v!=='string')stop('CONTRADICTED','STRING_REQUIRED');
   text(v);
   if(s==='nonempty'&&v.length===0)stop('CONTRADICTED','EMPTY_REQUIRED_STRING');
   if(s==='capture'&&v!=='FULL'&&v!=='PARTIAL'&&v!=='UNKNOWN')stop('CONTRADICTED','CAPTURE_OR_COVERAGE_INVALID');
   if(s.charCodeAt(0)===61&&v!==s.slice(1))stop('CONTRADICTED','INPUT_REFERENCE_KIND_INVALID');
   if(s==='hex'||s==='hash'||s==='address'||s==='calldata'){
    if(v.length<2||!v.startsWith('0x')||v.length%2!==0||(s==='hash'&&v.length!==66)||(s==='address'&&v.length!==42))stop('CONTRADICTED','HEX_FORMAT_INVALID');
    if(s==='calldata'&&(v.length-2)/2>1048576)stop('RESOURCE_LIMIT','CALLDATA_BYTES_EXCEEDED');
    for(let i=2;i<v.length;i++){const c=v.charCodeAt(i);if(!((c>=48&&c<=57)||(c>=65&&c<=70)||(c>=97&&c<=102)))stop('CONTRADICTED','HEX_FORMAT_INVALID');}
   }
   reserve(8+2*v.length);return v; // preserve original hex spelling
  }
  if('item'in s){
   if(s.nullable&&v===null){charge(1);return null;}
   if(!Array.isArray(v))stop('CONTRADICTED','ARRAY_REQUIRED');
   const n=own(v,'length');if(!Number.isSafeInteger(n)||n<0)stop('CONTRADICTED','ARRAY_LENGTH_INVALID');
   if(s.max!==undefined&&n>s.max)stop('RESOURCE_LIMIT','ARRAY_COUNT_EXCEEDED');
   charge(5);
   if(n>Math.floor((INPUT_LIMIT-inputBytes)/1))stop('RESOURCE_LIMIT','INPUT_BUDGET_EXCEEDED'); // each element >=1 logical byte
   reserve(16+8*n);const a:unknown[]=[];
   for(let i=0;i<n;i++)a.push(copy(own(v,String(i)),s.item));
   return Object.freeze(a);
  }
  if(typeof v!=='object'||v===null||Array.isArray(v))stop('CONTRADICTED','OBJECT_REQUIRED');
  charge(5);reserve(16+16*s.fields.length);const out:Record<string,unknown>={};
  for(const [k,t]of s.fields){text(k);out[k]=copy(own(v,k),t);if(s===root&&k==='scope')acquired=(out.scope as MappingInput['scope']).versions;}
  return Object.freeze(out);
 }
 try{
  const owned=copy(raw,root) as MappingInput;complete=true;
  const matched=matchProfile(owned.scope.versions,owned.budget);
  if(matched.status!=='MATCHED')stop(matched.status,matched.reasonCode);
  // Reserve only new subset wrapper; its references point to owned data.
  reserve(80);
  const observationInput:ObservationInput=Object.freeze({scope:owned.scope,budget:owned.budget,sources:owned.sources,provenance:owned.provenance});
  return Object.freeze({kind:'INPUT_READY' as const,owned,observationInput,inputBytes});
 }catch(error:unknown){
  if(error!==STOP)return counter.abortInput(error);
  const summary=`inputBytes=${inputBytes};inputComplete=${complete}`;
  const result:NonVerifiedResult<'MAPPING'>=Object.freeze({
   operation:'MAPPING',status:failure,reasonCode:reason,
   diagnostics:Object.freeze([Object.freeze({reasonCode:reason,message:summary,inputRefs:EMPTY,sourceRefs:EMPTY})]),
   versions:acquired,checked:Object.freeze([Object.freeze({code:complete?'MAPPING_INPUT_COUNT_COMPLETE':'MAPPING_INPUT_COUNT_PARTIAL',inputRefs:EMPTY})]),
   unchecked:Object.freeze([Object.freeze({code:'REMAINING_VALIDATION_NOT_ASSESSED',inputRefs:EMPTY}),Object.freeze({code:acquired===UNKNOWN_VERSIONS?'PROFILE_VERSIONS_UNAVAILABLE_EMPTY_PLACEHOLDERS':'PROFILE_ACCEPTANCE_NOT_ESTABLISHED',inputRefs:EMPTY})]),
   inputRefs:EMPTY,provenance:EMPTY,verificationScope:'PROVIDED_EVIDENCE_ONLY',canonicality:'NOT_ASSESSED',finality:'NOT_ASSESSED',
  });
  return counter.stopInput(result);
 }
}
