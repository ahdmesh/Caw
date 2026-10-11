import {Interface,keccak256} from 'ethers';
import {fixture as abiFixture,encode,setWord} from './abi-fixtures.mjs';
import {packed,sigs} from './association-fixtures.mjs';
export const AP=new Interface(['event ActionsProcessed(uint32 indexed networkId, uint32 indexed validatorId, uint16 actionCount, bytes32 batchHash)']);
export function event(f,network=1,validator=17,count=f.p.length===27?1:4,hash=keccak256(f.p)){
 const encoded=AP.encodeEventLog(AP.getEvent('ActionsProcessed'),[network,validator,count,hash]);
 f.input.sources[0].topics=[...encoded.topics];f.input.sources[0].data=encoded.data;
 f.input.receipt.logs[0].topics=[...encoded.topics];f.input.receipt.logs[0].data=encoded.data;
}
export function fixture(multi=false){
 const f=abiFixture(multi),s=f.input.sources[0];
 f.input.receipt.logs=[{logIndex:s.sourceLogIndex,transactionHash:s.transactionHash,chainId:s.chainId,
 blockHash:s.blockHash,blockNumber:s.blockNumber,transactionIndex:s.transactionIndex,emitter:s.emitter,topics:[],data:'0x'}];
 event(f);return f;
}
const dataConflict=f=>{f.input.receipt.logs[0].data='0x1234';};
export const cases=[
 {id:'N32-PARTIAL-COMMITMENT-MISMATCH',status:'CONTRADICTED',reason:'COMMITMENT_VALIDATOR_ID_MISMATCH',mutate(f){f.input.receiptLogCoverage.state='PARTIAL';event(f,1,18,1);}},
 {id:'N33-MISSING-SOURCE-HASH-COMMITMENT',status:'CONTRADICTED',reason:'COMMITMENT_BATCH_HASH_MISMATCH',mutate(f){f.input.sources[0].transactionHash=null;event(f,1,17,1,'0x'+'00'.repeat(32));}},
 {id:'N34-PARTIAL-COMMITMENT-EQUAL',status:'INSUFFICIENT',reason:'BINDING_CONTEXT_OR_COVERAGE_MISSING',mutate(f){f.input.receiptLogCoverage.state='PARTIAL';}},
 {id:'N35-MAX-ACTIONS',status:'VERIFIED',reason:'NORMAL_MAPPING_VERIFIED',mutate(f){f.p=packed(Array.from({length:256},(_,i)=>({sender:10,nonce:i,network:1})));f.sig=sigs([256]);f.input.transaction.data=encode(f.p,f.sig);event(f,1,17,256);}},
 {id:'N36-PARTIAL-OCCURRENCE',status:'INSUFFICIENT',reason:'REQUIRED_CONTEXT_MISSING',mutate(f){f.input.receiptLogCoverage.state='PARTIAL';f.input.transaction.blockHash=null;f.input.receipt.blockHash=null;f.input.sources[0].blockHash='0x'+'fe'.repeat(32);f.input.sources[0].transactionHash=null;dataConflict(f);}},
 {id:'N37-UNSUPPORTED-PLUS-CONFLICT',status:'CONTRADICTED',reason:'SOURCE_LOG_CONTENT_MISMATCH',mutate(f){f.input.transaction.data='0xffffffff'+f.input.transaction.data.slice(10);dataConflict(f);}},
 {id:'N01',status:'VERIFIED',reason:'NORMAL_MAPPING_VERIFIED'},
 {id:'N02',multi:true,status:'VERIFIED',reason:'NORMAL_MAPPING_VERIFIED'},
 {id:'N03-REACQUISITION',status:'VERIFIED',reason:'NORMAL_MAPPING_VERIFIED',mutate(f){const x=f.input;x.provenance.push({...x.provenance[0],id:'p2',provider:'second'});x.sources.push({...x.sources[0],inputRef:{kind:'SOURCE',id:'s2'},provenance:[{id:'p2'}]});}},
 {id:'N04-Y01',status:'CONTRADICTED',reason:'SOURCE_LOG_CONTENT_MISMATCH',mutate(f){f.input.transaction.data=null;f.input.receiptLogCoverage.state='PARTIAL';dataConflict(f);}},
 {id:'N05-Y02',status:'CONTRADICTED',reason:'SOURCE_LOG_CONTENT_MISMATCH',mutate(f){f.input.sources[0].transactionHash=null;f.input.receiptLogCoverage.state='PARTIAL';dataConflict(f);}},
 {id:'N06-Y03',status:'INSUFFICIENT',reason:'BINDING_CONTEXT_OR_COVERAGE_MISSING',mutate(f){f.input.transaction.data=null;f.input.receiptLogCoverage.state='PARTIAL';}},
 {id:'N07-Y04',status:'INSUFFICIENT',reason:'REQUIRED_CONTEXT_MISSING',mutate(f){f.input.sources[0].blockHash=null;f.input.receiptLogCoverage.state='PARTIAL';dataConflict(f);}},
 {id:'N08-OCCURRENCE',status:'CONTRADICTED',reason:'BLOCK_HASH_MISMATCH',mutate(f){f.input.sources[0].blockHash='0x'+'11'.repeat(32);}},
 {id:'N09-MALFORMED',status:'CONTRADICTED',reason:'NORMAL_PACKED_ACTIONS_MALFORMED',mutate(f){f.input.transaction.data=encode(new Uint8Array([0,1]),f.sig);}},
 {id:'N10-ZERO-ACTIONS',status:'CONTRADICTED',reason:'NORMAL_PACKED_ACTIONS_MALFORMED',mutate(f){f.input.transaction.data=encode(new Uint8Array([0,0]),f.sig);}},
 {id:'N11-TRAILING-PACKED',status:'CONTRADICTED',reason:'NORMAL_PACKED_ACTIONS_MALFORMED',mutate(f){f.input.transaction.data=encode(new Uint8Array([...f.p,0]),f.sig);}},
 {id:'N12-MISSING-PLUS-MALFORMED',status:'CONTRADICTED',reason:'NORMAL_PACKED_ACTIONS_MALFORMED',mutate(f){f.input.sourceCoverage.state='PARTIAL';f.input.transaction.data=encode(new Uint8Array([0,1]),f.sig);}},
 ...[['VALIDATOR',1,18,1,'COMMITMENT_VALIDATOR_ID_MISMATCH'],['NETWORK',2,17,1,'COMMITMENT_NETWORK_ID_MISMATCH'],['COUNT',1,17,2,'COMMITMENT_ACTION_COUNT_MISMATCH']].map(([name,n,v,c,reason])=>({id:'N13-'+name,status:'CONTRADICTED',reason,mutate(f){event(f,n,v,c);}})),
 {id:'N14-HASH',status:'CONTRADICTED',reason:'COMMITMENT_BATCH_HASH_MISMATCH',mutate(f){event(f,1,17,1,'0x'+'00'.repeat(32));}},
 {id:'N15-UNRESOLVED-PROVENANCE',status:'INSUFFICIENT',reason:'PROVENANCE_REFERENCE_UNRESOLVED',mutate(f){f.input.sources[0].provenance=[{id:'absent'}];}},
 {id:'N16-GETTER',status:'CONTRADICTED',reason:'REQUIRED_DATA_PROPERTY_INVALID',getter:true,mutate(f,c){Object.defineProperty(f.input.transaction,'data',{get(){c.getters++;throw new Error('GETTER CALLED');}});}},
 {id:'N17-SOURCE-LIMIT',status:'RESOURCE_LIMIT',reason:'ARRAY_COUNT_EXCEEDED',mutate(f){f.input.sources=Array(4097).fill(f.input.sources[0]);}},
 {id:'N18-LOGICAL-LIMIT',status:'RESOURCE_LIMIT',reason:'INPUT_BUDGET_EXCEEDED',mutate(f){f.input.provenance[0].description='x'.repeat(8388608);}},
 {id:'N19-COMMITMENT-RESERVE',status:'RESOURCE_LIMIT',reason:'COMMITMENT_AUX_LIMIT',denyBytes:2780},
 {id:'N20-CALLBACK-THROW',status:'THROW',reason:null,throwBytes:2780},
 {id:'N21-PARSER-INTERNAL',status:'THROW',reason:null,parserFault:true},
 {id:'N22-COMMITMENT-INTERNAL',status:'THROW',reason:null,commitmentFault:true},
 {id:'N23-OUTPUT-RESERVE',status:'RESOURCE_LIMIT',reason:'NORMAL_OUTPUT_AUX_LIMIT',denyBytes:4992},
 {id:'N24-UNKNOWN-PROFILE',status:'UNSUPPORTED',reason:'PROFILE_VERSION_UNSUPPORTED',mutate(f){f.input.scope.versions.abi='unknown';}},
 {id:'N25-BIGINT',status:'VERIFIED',reason:'NORMAL_MAPPING_VERIFIED',mutate(f){const x=f.input;for(const o of [x.transaction,x.receipt,x.sources[0],x.receipt.logs[0]])o.blockNumber=(1n<<60n)+3n;}},
 {id:'N26-PARTIAL-REJECTED',status:'CONTRADICTED',reason:'NORMAL_ACTION_REJECTED_PRESENT',mutate(f){f.input.receiptLogCoverage.state='PARTIAL';f.input.receipt.logs.push({...f.input.receipt.logs[0],logIndex:8,topics:['0xec56a08d611053c4998936acc2a5a9474184899d68dc5ca286b3da697e1a1d4a']});}},
 {id:'N27-PARTIAL-ABI-BAD',status:'CONTRADICTED',reason:'NORMAL_ABI_HEAD_TRUNCATED',mutate(f){f.input.sourceCoverage.state='PARTIAL';f.input.transaction.data='0xe9e962ff';}},
 {id:'N28-SIGNATURE-SHORT',status:'UNSUPPORTED',reason:'NORMAL_SHORT_SIGNATURE_READ_UNSUPPORTED',mutate(f){f.input.transaction.data=encode(f.p,f.sig.slice(0,-2));}},
 {id:'N29-SIGNATURE-TRAILING',status:'VERIFIED',reason:'NORMAL_MAPPING_VERIFIED',mutate(f){f.input.transaction.data=encode(f.p,f.sig+'1234');}},
 {id:'N30-NULL-DATA',status:'INSUFFICIENT',reason:'NORMAL_ABI_CALLDATA_MISSING',mutate(f){f.input.transaction.data=null;}},
 {id:'N31-TOPICS-LIMIT',status:'RESOURCE_LIMIT',reason:'ARRAY_COUNT_EXCEEDED',getter:true,mutate(f,c){f.input.sources[0].topics=Array(5);Object.defineProperty(f.input.sources[0],'data',{get(){c.getters++;throw new Error('READ AFTER STOP');}});}},
];

// Reuse R27 sender/nonce/network counterexamples at the actual public boundary.
import {fixtures as associationCases} from './association-fixtures.mjs';
for(const a of associationCases.filter(x=>['A03','A04','A05','A06','A07','A08','A09'].includes(x.id))){
 cases.push({id:'REUSED-'+a.id,status:a.status==='ASSOCIATED'?'VERIFIED':a.status,
  reason:a.reason??'NORMAL_MAPPING_VERIFIED',mutate(f){
   f.p=packed(a.actions);f.sig=sigs(a.sizes);f.input.transaction.data=encode(f.p,f.sig);
   event(f,1,17,a.actions.length);
  }});
}
cases.push({id:'N38-ACTION-COUNT-257',status:'CONTRADICTED',reason:'NORMAL_PACKED_ACTIONS_MALFORMED',
 mutate(f){f.input.transaction.data=encode(new Uint8Array([1,1]),f.sig);}});
