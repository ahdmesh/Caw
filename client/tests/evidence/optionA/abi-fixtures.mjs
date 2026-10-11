import {base} from './fixtures.mjs';
import {packed,sigs} from './association-fixtures.mjs';
// Coordinator-confirmed fixed processActions selector; not derived by Work.
export const SELECTOR='0xe9e962ff';
const word=n=>BigInt(n).toString(16).padStart(64,'0');
const tail=h=>word(h.length/2)+h.padEnd(Math.ceil(h.length/64)*64,'0');
export function encode(p,s){const a=tail(Buffer.from(p).toString('hex')),b=tail(s.slice(2));return SELECTOR+word(17)+word(160)+word(160+a.length/2)+word((1n<<255n)+7n)+word(19)+a+b;}
export function setWord(data,at,n){return data.slice(0,2+at*2)+word(n)+data.slice(2+(at+32)*2);}
export function fixture(multi=false){const x=base(),s=x.sources[0];const acts=multi?[{sender:10,nonce:7,network:1},{sender:20,nonce:50,network:1},{sender:20,nonce:51,network:1},{sender:30,nonce:3,network:1}]:[{sender:10,nonce:7,network:1}];const p=packed(acts),sig=sigs(multi?[1,2,1]:[1]);
 const input={scope:x.scope,budget:x.budget,transaction:{inputRef:{kind:'TRANSACTION',id:'t1'},hash:s.transactionHash,chainId:s.chainId,blockHash:s.blockHash,blockNumber:s.blockNumber,transactionIndex:s.transactionIndex,to:s.emitter,data:encode(p,sig),capture:'FULL',provenance:[{id:'p1'}]},receipt:{inputRef:{kind:'RECEIPT',id:'r1'},transactionHash:s.transactionHash,chainId:s.chainId,blockHash:s.blockHash,blockNumber:s.blockNumber,transactionIndex:s.transactionIndex,status:1,logs:[],capture:'FULL',provenance:[{id:'p1'}]},sources:x.sources,receiptLogCoverage:{inputRef:{kind:'COVERAGE',id:'rc'},state:'FULL',provenance:[{id:'p1'}]},sourceCoverage:{inputRef:{kind:'COVERAGE',id:'sc'},state:'FULL',provenance:[{id:'p1'}]},provenance:x.provenance};return {input,p,sig};}
// Fixed before execution. These test ABI layout using the fixed NORMAL selector.
export const cases=[
 {id:'B01',status:'DECODED',reason:'NORMAL_ABI_DECODED',association:true},
 {id:'B02',status:'DECODED',reason:'NORMAL_ABI_DECODED',multi:true,association:true},
 {id:'B03',status:'UNSUPPORTED',reason:'NORMAL_ABI_SELECTOR_UNSUPPORTED',mutate:t=>{t.data='0xffffffff'+t.data.slice(10);}},
 {id:'B04',status:'CONTRADICTED',reason:'NORMAL_ABI_HEAD_TRUNCATED',mutate:t=>{t.data=t.data.slice(0,2+100*2);}},
 {id:'B05',status:'CONTRADICTED',reason:'NORMAL_ABI_OFFSET_RANGE',mutate:t=>{t.data=setWord(t.data,36,(1n<<256n)-1n);}},
 {id:'B06',status:'CONTRADICTED',reason:'NORMAL_ABI_SIGS_LENGTH_RANGE',mutate:t=>{t.data=setWord(t.data,228,(1n<<256n)-1n);}},
 {id:'B07',status:'CONTRADICTED',reason:'NORMAL_ABI_PACKED_LENGTH_RANGE',mutate:t=>{t.data=setWord(t.data,68,160).slice(0,2+206*2);}},
 {id:'B08',status:'CONTRADICTED',reason:'NORMAL_ABI_SIGS_LENGTH_RANGE',mutate:t=>{t.data=t.data.slice(0,2+265*2);}},
 {id:'B09',status:'CONTRADICTED',reason:'NORMAL_ABI_VALIDATOR_RANGE',mutate:t=>{t.data=setWord(t.data,4,1n<<32n);}},
 {id:'B10',status:'UNSUPPORTED',reason:'NORMAL_ABI_LAYOUT_UNSUPPORTED',mutate:t=>{t.data=setWord(t.data,68,160);}},
 {id:'B11',status:'RESOURCE_LIMIT',reason:'NORMAL_ABI_AUX_LIMIT',reject:true},
 {id:'B12',status:'DECODED',reason:'NORMAL_ABI_DECODED',mutateAfter:true},
 {id:'B13-CAPTURE',status:'INSUFFICIENT',reason:'NORMAL_ABI_CAPTURE_NOT_FULL',mutate:t=>{t.capture='PARTIAL';}},
 {id:'B14-NULL',status:'INSUFFICIENT',reason:'NORMAL_ABI_CALLDATA_MISSING',mutate:t=>{t.data=null;}},
 {id:'B15-TRAILING',status:'UNSUPPORTED',reason:'NORMAL_ABI_PADDING_OR_TRAILING_UNSUPPORTED',mutate:t=>{t.data+='00';}},
 {id:'B16-CALLBACK',status:'THROW',reason:null,fault:true},
];
