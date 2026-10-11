const versions = {
  abi: "optiona-abi-97cd13f3-targets-v1",
  rules: "optiona-rules-i07-v1",
  budget: "optiona-budget-i07-r12-v1",
};
const limits = {
  maxCalldataBytes: 1048576, maxPackedActionBytes: 1048576,
  maxLogicalInputBytes: 8388608, maxReceiptLogs: 4096,
  maxSourceRecords: 4096, maxLogTopics: 4,
  maxNormalSafeActions: 256, maxNormalSafeGroups: 256,
  maxERC1271Groups: 1024, maxERC1271Actions: 4096,
  maxERC1271GroupSize: 65535, maxSafeDPStates: 66049,
  maxSafeDPWorkUnits: 262144, maxReasonByteComparisons: 16777216,
  maxAuxiliaryBufferBytes: 33554432, maxDiagnostics: 32,
};
const hash = byte => "0x" + byte.repeat(32);
const emitter = "0x" + "ab".repeat(20);
function base() {
  return {
    scope: {
      inputRef: {kind: "SCOPE", id: "scope-1"},
      expectedChainId: 1n, normalEmitter: emitter,
      erc1271Emitter: null, versions: {...versions},
      provenance: [{id:"p1"}],
    },
    budget: {
      inputRef: {kind:"BUDGET",id:"budget-1"},
      version: versions.budget, ...limits, provenance:[{id:"p1"}],
    },
    sources: [{
      inputRef:{kind:"SOURCE",id:"s1"}, chainId:1n,
      blockHash:hash("AB"), blockNumber:123n,
      transactionHash:hash("CD"), transactionIndex:0,
      sourceLogIndex:7, emitter, topics:[hash("EF")],
      data:"0xABCD", provenance:[{id:"p1"}],
    }],
    provenance:[{
      id:"p1", method:"synthetic", provider:"fixture",
      acquisitionScope:"synthetic-only", capture:"FULL",
      captureTime:null, description:null,
    }],
  };
}

// Expectations fixed before execution; no target-source changes.
const cloneSource=(x,id,overrides={})=>({...x.sources[0],inputRef:{kind:"SOURCE",id},...overrides});
const getterSentinel=(object,key,counters,label)=>Object.defineProperty(object,key,{enumerable:true,configurable:true,get(){counters[label]=(counters[label]??0)+1;throw new Error("FORBIDDEN_GETTER:"+label);}});
export const cases=[
 {id:"T01",expected:"CONTRADICTED",reason:"SOURCE_IDENTITY_CONFLICT",related:"knownConflict / identity buckets", mutate(x){const original=x.sources[0]; x.sources=[{...original,transactionHash:null},cloneSource(x,"s2",{transactionHash:hash("11")}),cloneSource(x,"s3",{transactionHash:hash("22")})];}},
 ...["transactionHash","blockNumber","transactionIndex"].map((field,i)=>({id:"T02"+String.fromCharCode(97+i),expected:"INSUFFICIENT",reason:{transactionHash:"REQUIRED_CONTEXT_MISSING",blockNumber:"BLOCK_NUMBER_MISSING",transactionIndex:"TRANSACTION_INDEX_MISSING"}[field],related:"normalizeSource / no missing-context fill",mutate(x){x.sources.push(cloneSource(x,"s2")); x.sources[0][field]=null;}})),
 {id:"T03",expected:"CONTRADICTED",reason:"SOURCE_INPUT_ID_CONFLICT",related:"sourceIds / sameNormalizedSource",mutate(x){x.sources.push(cloneSource(x,"s1",{data:"0x1234"}));}},
 {id:"T04",expected:"CONTRADICTED",reason:"PROVENANCE_ID_CONFLICT",related:"provenanceById",mutate(x){x.provenance.push({...x.provenance[0],provider:"other"});}},
 {id:"T05",expected:"INSUFFICIENT",reason:"PROVENANCE_REFERENCE_UNRESOLVED",related:"checkProvenanceRefs",mutate(x){x.sources[0].provenance=[{id:"missing"}];}},
 {id:"T06",expected:"UNSUPPORTED",reason:"SOURCE_EMITTER_OUTSIDE_SCOPE",related:"scope emitter membership",mutate(x){x.scope.erc1271Emitter="0x"+"12".repeat(20); x.sources[0].emitter="0x"+"34".repeat(20);}},
 {id:"T07",expected:"VERIFIED",reason:"OBSERVATIONS_NORMALIZED",count:2,related:"scope emitter membership / identity buckets",mutate(x){x.scope.erc1271Emitter="0x"+"12".repeat(20);x.sources.push(cloneSource(x,"s2",{sourceLogIndex:8,emitter:x.scope.erc1271Emitter}));}},
 {id:"T08",expected:"CONTRADICTED",reason:"SOURCE_IDENTITY_CONFLICT",related:"addIssue priority / knownConflict",mutate(x){x.sources=[cloneSource(x,"s1",{transactionHash:null}),cloneSource(x,"s2",{transactionHash:hash("11")}),cloneSource(x,"s3",{transactionHash:hash("22")})];}},
 {id:"T09",expected:"RESOURCE_LIMIT",reason:"ARRAY_COUNT_EXCEEDED",related:"copyValue array max / finish",mutate(x,c){x.sources[0].topics=Array(5);for(let i=0;i<5;i++)getterSentinel(x.sources[0].topics,String(i),c,"topic"+i);getterSentinel(x.sources[0],"data",c,"laterData");getterSentinel(x,"provenance",c,"laterProvenance");}},
 ...[[-1,"negative","SOURCE_LOG_INDEX_INVALID"],[0.5,"fraction","SOURCE_LOG_INDEX_INVALID"],[Infinity,"infinity","NONFINITE_NUMBER"]].map(([value,label,reason])=>({id:"T10-"+label,expected:"CONTRADICTED",reason,related:"copyValue / normalizeSource",mutate(x){x.sources[0].sourceLogIndex=value;}})),
 ...["source","scope"].map(place=>({id:"T11-"+place,expected:"CONTRADICTED",reason:"REQUIRED_DATA_PROPERTY_INVALID",related:"ownValue / finish",mutate(x,c){getterSentinel(place==="source"?x.sources[0]:x.scope,place==="source"?"transactionHash":"versions",c,"mandatoryGetter");}})),
];

export {base};
