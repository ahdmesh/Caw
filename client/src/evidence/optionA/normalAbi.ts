import type {MappingInput, NonVerifiedResult, HexBytes} from './types';
import type {createMappingBudgetBoundary} from './mappingBudget';

type Counter = ReturnType<typeof createMappingBudgetBoundary>;
type FailureStatus = 'CONTRADICTED'|'INSUFFICIENT'|'UNSUPPORTED'|'RESOURCE_LIMIT';
// INTERNAL ONLY. Input must be R34 INPUT_READY. Fixed selector supplied by
// the coordinator for the fixed Solidity ABI; not independently derived here.
// Never obtained from MappingInput or an arbitrary caller argument.
const registeredNormalSelector = "0xe9e962ff";
// No public barrel/API or profile definition is changed here.
const CONTROL = 16384;
// Logical allowance, not heap/RSS: <=256 scalar/capture slots*16=4096;
// <=16 objects*272=4352; <=8 arrays*144=1152; <=8 strings*392=3136;
// two uint256 conversions: 2*(8+128)=272 (bounded hex substrings),
// two bigint result allowances*40=80. Total 13088 <16384.
// No unbounded bigint intermediate loop, lists, or diagnostic accumulation.
const EMPTY = Object.freeze([]);
const AUX_FAILURE = Object.freeze({status:'RESOURCE_LIMIT',reasonCode:'NORMAL_ABI_AUX_LIMIT'} as const);
const UNCHECKED = Object.freeze([
 Object.freeze({code:'NORMAL_ABI_REMAINING_NOT_ASSESSED',inputRefs:EMPTY}),
 Object.freeze({code:'RECEIPT_MAPPING_COMMITMENT_NOT_ASSESSED',inputRefs:EMPTY}),
]);

export function decodeNormalAbi(
 owned:MappingInput,
 counter:Counter,
 deferOrdinaryFailure = false,
) {
 // Trusted caller contract, not a raw-input validator.
 if(counter.phase!=='ACTIVE')return counter.abortInput(new Error('ABI requires active counter'));
 try {
  // Reserve before constructing per-call closures, metadata and stop results.
  if(!counter.reserveAux(CONTROL))return AUX_FAILURE;
  if(!/^0x[0-9a-f]{8}$/.test(registeredNormalSelector))
   throw new Error('Trusted NORMAL selector registration missing or malformed');

  function fail(status:FailureStatus,reasonCode:string) {
   const result:NonVerifiedResult<'MAPPING'>=Object.freeze({
    operation:'MAPPING',status,reasonCode,diagnostics:EMPTY,
    versions:owned.scope.versions,checked:EMPTY,unchecked:UNCHECKED,
    inputRefs:EMPTY,provenance:EMPTY,
    verificationScope:'PROVIDED_EVIDENCE_ONLY',canonicality:'NOT_ASSESSED',finality:'NOT_ASSESSED',
   });
   if (!deferOrdinaryFailure || status === "RESOURCE_LIMIT") counter.stopEvidence(result);
   return Object.freeze({status,reasonCode});
  }
  const tx=owned.transaction;
  if(tx.capture!=='FULL')return fail('INSUFFICIENT','NORMAL_ABI_CAPTURE_NOT_FULL');
  const data=tx.data;
  if(data===null)return fail('INSUFFICIENT','NORMAL_ABI_CALLDATA_MISSING');
  // Shape/hex validation and logical input charging already done by R34.
  const bytes=(data.length-2)/2;
  if(!Number.isSafeInteger(bytes)||bytes<0)throw new Error('Owned calldata invariant');
  if(bytes>1048576)return fail('RESOURCE_LIMIT','NORMAL_ABI_CALLDATA_LIMIT');
  if(bytes<4)return fail('CONTRADICTED','NORMAL_ABI_SELECTOR_TRUNCATED');
  if(data.slice(0,10).toLowerCase()!==registeredNormalSelector)
   return fail('UNSUPPORTED','NORMAL_ABI_SELECTOR_UNSUPPORTED');
  if(bytes<164)return fail('CONTRADICTED','NORMAL_ABI_HEAD_TRUNCATED');

  // Decode hex without allocating per-byte substrings.
  function nibble(i:number):number {
   const c=data!.charCodeAt(i);
   return c<=57?c-48:(c|32)-87;
  }
  function byte(at:number):number {const i=2+at*2;return nibble(i)*16+nibble(i+1);}
  // Returns -1 before multiplication could exceed a small trusted bound.
  function boundedWord(at:number,max:number):number {
   let n=0;
   for(let i=0;i<32;i++){
    const x=byte(at+i);
    if(n>Math.floor((max-x)/256))return -1;
    n=n*256+x;
   }
   return n;
  }
  const validatorId=boundedWord(4,0xffffffff);
  if(validatorId<0)return fail('CONTRADICTED','NORMAL_ABI_VALIDATOR_RANGE');
  const argsBytes=bytes-4;
  const packedOffset=boundedWord(36,argsBytes);
  const sigOffset=boundedWord(68,argsBytes);
  if(packedOffset<0||sigOffset<0||packedOffset>argsBytes-32||sigOffset>argsBytes-32)
   return fail('CONTRADICTED','NORMAL_ABI_OFFSET_RANGE');
  // Noncanonical layouts are outside this adapter, not asserted to revert.
  if(packedOffset!==160||sigOffset%32!==0||sigOffset<160)
   return fail('UNSUPPORTED','NORMAL_ABI_LAYOUT_UNSUPPORTED');
  const packedStart=4+packedOffset+32;
  const packedLength=boundedWord(4+packedOffset,bytes-packedStart);
  if(packedLength<0)return fail('CONTRADICTED','NORMAL_ABI_PACKED_LENGTH_RANGE');
  const packedEnd=packedStart+packedLength;
  const packedPaddedEnd=packedEnd+(32-packedLength%32)%32;
  if(packedPaddedEnd>bytes)return fail('UNSUPPORTED','NORMAL_ABI_PADDING_UNSUPPORTED');
  if(4+sigOffset!==packedPaddedEnd)
   return fail('UNSUPPORTED','NORMAL_ABI_LAYOUT_UNSUPPORTED');
  const sigStart=4+sigOffset+32;
  const sigLength=boundedWord(4+sigOffset,bytes-sigStart);
  if(sigLength<0)return fail('CONTRADICTED','NORMAL_ABI_SIGS_LENGTH_RANGE');
  const sigEnd=sigStart+sigLength;
  const sigPaddedEnd=sigEnd+(32-sigLength%32)%32;
  if(sigPaddedEnd!==bytes)return fail('UNSUPPORTED','NORMAL_ABI_PADDING_OR_TRAILING_UNSUPPORTED');
  for(let i=packedEnd;i<packedPaddedEnd;i++)
   if(byte(i)!==0)return fail('UNSUPPORTED','NORMAL_ABI_PADDING_UNSUPPORTED');
  for(let i=sigEnd;i<sigPaddedEnd;i++)
   if(byte(i)!==0)return fail('UNSUPPORTED','NORMAL_ABI_PADDING_UNSUPPORTED');

  // packed buffer/header + sig substring, concatenation and lower-case copy.
  // Each sig string <=2+2*sigLength code units. Cumulative conservative cost.
  const copyReservation=32+packedLength+3*(8+2*(2+2*sigLength));
  if(!Number.isSafeInteger(copyReservation))throw new Error('ABI reservation invariant');
  if(!counter.reserveAux(copyReservation))return AUX_FAILURE;
  const packed=new Uint8Array(packedLength);
  for(let i=0;i<packedLength;i++)packed[i]=byte(packedStart+i);
  const sigs=('0x'+data.slice(2+2*sigStart,2+2*sigEnd)).toLowerCase() as HexBytes;
  const withdrawFee=BigInt('0x'+data.slice(2+2*100,2+2*132));
  const withdrawLzTokenAmount=BigInt('0x'+data.slice(2+2*132,2+2*164));
  // All ranges are absolute calldata byte offsets, end-exclusive.
  const metadata=Object.freeze({validatorId,withdrawFee,withdrawLzTokenAmount,
   calldataBytes:bytes,
   selector:Object.freeze({start:0,end:4}),
   head:Object.freeze({start:4,end:164}),
   packedActions:Object.freeze({offsetWord:36,lengthWord:4+packedOffset,start:packedStart,end:packedEnd,paddedEnd:packedPaddedEnd}),
   sigs:Object.freeze({offsetWord:68,lengthWord:4+sigOffset,start:sigStart,end:sigEnd,paddedEnd:sigPaddedEnd}),
   withdrawFeeRange:Object.freeze({start:100,end:132}),
   withdrawLzTokenAmountRange:Object.freeze({start:132,end:164}),
  });
  let consumed=false;
  return Object.freeze({status:'DECODED' as const,reasonCode:'NORMAL_ABI_DECODED',metadata,
   // Owned mutable bytes stay behind a one-shot trusted internal consumer.
   // They are not exposed as a frozen public success payload.
   consumeOwned<T>(consumer:(packed:Uint8Array,sigs:HexBytes)=>T):T {
    if(consumed||counter.phase!=='ACTIVE')return counter.abortInput(new Error('ABI ownership already consumed or stopped'));
    consumed=true;
    try{return consumer(packed,sigs);}catch(error:unknown){return counter.abortInput(error);}
   },
  });
 }catch(error:unknown){return counter.abortInput(error);}
}
