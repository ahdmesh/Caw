import {fixture,TOPICS} from './binding-fixtures.mjs';
export {fixture,TOPICS};
// Expectations fixed before execution; no output-derived classifications.
export const specs=[
 {id:'X01',status:'CONTRADICTED',reason:'SOURCE_LOG_CONTENT_MISMATCH',mutate:x=>{x.receiptLogCoverage.state='PARTIAL';x.receipt.logs[0].data='0x1234';}},
 {id:'X02',status:'INSUFFICIENT',reason:'BINDING_CONTEXT_OR_COVERAGE_MISSING',mutate:x=>{x.receiptLogCoverage.state='PARTIAL';}},
 {id:'X03',status:'CONTRADICTED',reason:'SOURCE_LOG_CONTENT_MISMATCH',mutate:x=>{x.receipt.logs[0].data='0x1234';}},
 {id:'X04',status:'INSUFFICIENT',reason:'REQUIRED_CONTEXT_MISSING',mutate:x=>{x.receiptLogCoverage.state='PARTIAL';x.sources[0].transactionHash=null;}},
 {id:'X05',status:'RESOURCE_LIMIT',reason:'BINDING_AUX_LIMIT',rejectKnown:true,mutate:x=>{x.receiptLogCoverage.state='PARTIAL';x.receipt.logs[0].data='0x1234';}},
 {id:'X06',status:'THROW',reason:null,faultKnown:true,mutate:x=>{x.receiptLogCoverage.state='PARTIAL';x.receipt.logs[0].data='0x1234';}},
];
