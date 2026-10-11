import {base} from './fixtures.mjs';
// Fixed topic values supplied by coordinator; not independently computed.
export const TOPICS=Object.freeze({ap:'0xd546c3e1b2cc91bad7dbdf7a2152244afd0b547288e352b479b64d83bda1c59d',rejected:'0xec56a08d611053c4998936acc2a5a9474184899d68dc5ca286b3da697e1a1d4a'});
export function fixture(){const x=base(),s=x.sources[0];s.topics=[TOPICS.ap];s.blockNumber=(1n<<60n)+3n;
return {scope:x.scope,budget:x.budget,transaction:{inputRef:{kind:'TRANSACTION',id:'t1'},hash:s.transactionHash,chainId:s.chainId,blockHash:s.blockHash,blockNumber:s.blockNumber,transactionIndex:s.transactionIndex,to:s.emitter,data:'0xe9e962ff',capture:'FULL',provenance:[{id:'p1'}]},receipt:{inputRef:{kind:'RECEIPT',id:'r1'},transactionHash:s.transactionHash,chainId:s.chainId,blockHash:s.blockHash,blockNumber:s.blockNumber,transactionIndex:s.transactionIndex,status:1,logs:[{logIndex:s.sourceLogIndex,transactionHash:s.transactionHash,chainId:s.chainId,blockHash:s.blockHash,blockNumber:s.blockNumber,transactionIndex:s.transactionIndex,emitter:s.emitter,topics:[...s.topics],data:s.data}],capture:'FULL',provenance:[{id:'p1'}]},sources:x.sources,receiptLogCoverage:{inputRef:{kind:'COVERAGE',id:'rc'},state:'FULL',provenance:[{id:'p1'}]},sourceCoverage:{inputRef:{kind:'COVERAGE',id:'sc'},state:'FULL',provenance:[{id:'p1'}]},provenance:x.provenance};}
export const specs=[
{id:'E01',status:'BOUND',reason:'NORMAL_EVIDENCE_BOUND'},
{id:'E02',status:'CONTRADICTED',reason:'TRANSACTION_HASH_MISMATCH',mutate:x=>{x.receipt.transactionHash='0x'+'ff'.repeat(32);}},
{id:'E03',status:'CONTRADICTED',reason:'BLOCK_HASH_MISMATCH',mutate:x=>{x.receipt.blockHash='0x'+'ff'.repeat(32);}},
{id:'E04',status:'CONTRADICTED',reason:'BLOCK_NUMBER_MISMATCH',mutate:x=>{x.receipt.blockNumber++;}},
{id:'E05',status:'CONTRADICTED',reason:'TRANSACTION_INDEX_MISMATCH',mutate:x=>{x.receipt.transactionIndex++;}},
{id:'E06',status:'CONTRADICTED',reason:'RECEIPT_NOT_SUCCESSFUL',mutate:x=>{x.receipt.status=0;}},
{id:'E07',status:'CONTRADICTED',reason:'RECEIPT_LOG_INDEX_NOT_UNIQUE',mutate:x=>{x.receipt.logs.push({...x.receipt.logs[0]});}},
{id:'E08',status:'CONTRADICTED',reason:'SOURCE_EVENT_NOT_IN_RECEIPT',mutate:x=>{x.sources[0].sourceLogIndex++;}},
{id:'E09',status:'INSUFFICIENT',reason:'SOURCE_EVIDENCE_MISSING',mutate:x=>{x.sources=[];}},
{id:'E10',status:'INSUFFICIENT',reason:'BINDING_CONTEXT_OR_COVERAGE_MISSING',mutate:x=>{x.receiptLogCoverage.state='PARTIAL';}},
{id:'E11',status:'CONTRADICTED',reason:'BLOCK_HASH_MISMATCH',mutate:x=>{x.sources[0].blockHash='0x'+'ff'.repeat(32);}},
{id:'E12',status:'BOUND',reason:'NORMAL_EVIDENCE_BOUND',mutate:x=>{x.sources.push({...x.sources[0],inputRef:{kind:'SOURCE',id:'reacquired'}});}},
{id:'E13',status:'CONTRADICTED',reason:'NORMAL_ACTION_REJECTED_PRESENT',mutate:x=>{x.receipt.logs.push({...x.receipt.logs[0],logIndex:99,topics:[TOPICS.rejected]});}},
{id:'E14',status:'UNSUPPORTED',reason:'NORMAL_MIXED_EVENT_EMITTERS',mutate:x=>{x.scope.erc1271Emitter='0x'+'cd'.repeat(20);x.receipt.logs.push({...x.receipt.logs[0],logIndex:99,emitter:x.scope.erc1271Emitter});}},
{id:'E15',status:'RESOURCE_LIMIT',reason:'BINDING_AUX_LIMIT',reject:true},
{id:'E16',status:'THROW',reason:null,fault:true},
];
