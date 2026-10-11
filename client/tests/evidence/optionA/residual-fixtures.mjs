import {fixture,TOPICS} from './binding-fixtures.mjs';
export {fixture,TOPICS};
// Expectations fixed from contract/original reason definitions before runtime.
export const specs=[
{id:'Y01',status:'CONTRADICTED',reason:'SOURCE_LOG_CONTENT_MISMATCH',mutate:x=>{x.receiptLogCoverage.state='PARTIAL';x.transaction.data=null;x.receipt.logs[0].data='0x1234';}},
{id:'Y02',status:'CONTRADICTED',reason:'SOURCE_LOG_CONTENT_MISMATCH',mutate:x=>{x.receiptLogCoverage.state='PARTIAL';x.sources[0].transactionHash=null;x.receipt.logs[0].data='0x1234';}},
{id:'Y03',status:'INSUFFICIENT',reason:'BINDING_CONTEXT_OR_COVERAGE_MISSING',mutate:x=>{x.receiptLogCoverage.state='PARTIAL';x.transaction.data=null;}},
{id:'Y04',status:'INSUFFICIENT',reason:'REQUIRED_CONTEXT_MISSING',mutate:x=>{x.receiptLogCoverage.state='PARTIAL';x.sources[0].blockHash=null;x.receipt.logs[0].data='0x1234';}},
// Parent blockHash unacquired on purpose. Individual log/source occurrences
// differ; do not equate them merely because their real logIndex matches.
{id:'Y05',status:'INSUFFICIENT',reason:'REQUIRED_CONTEXT_MISSING',mutate:x=>{x.receiptLogCoverage.state='PARTIAL';x.transaction.blockHash=null;x.receipt.blockHash=null;x.sources[0].blockHash='0x'+'fe'.repeat(32);x.sources[0].transactionHash=null;x.receipt.logs[0].data='0x1234';}},
{id:'Y06',status:'RESOURCE_LIMIT',reason:'BINDING_AUX_LIMIT',rejectKnown:true,mutate:x=>{x.receiptLogCoverage.state='PARTIAL';x.transaction.data=null;x.receipt.logs[0].data='0x1234';}},
{id:'Y07',status:'THROW',reason:null,faultKnown:true,mutate:x=>{x.receiptLogCoverage.state='PARTIAL';x.sources[0].transactionHash=null;x.receipt.logs[0].data='0x1234';}},
];
