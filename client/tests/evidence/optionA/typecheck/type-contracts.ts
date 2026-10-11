import {mapNormal} from '../../../../src/evidence/optionA/index';
import type {MappingInput, NormalMappingResult, SourceRecord, Scope} from '../../../../src/evidence/optionA/types';
declare const input:MappingInput;
const result:NormalMappingResult=mapNormal(input);
if(result.status==='VERIFIED'){
 const profile:'NORMAL'=result.mapping.profile;
 const outcome:'HAS_SUCCESS'=result.mapping.outcomeKind;
 const exactlyOne:1=result.mapping.commitment.events.length;
 // @ts-expect-error NORMAL cannot produce SAFE success.
 const wrongProfile:'SAFE'=result.mapping.profile;
 void [profile,outcome,exactlyOne,wrongProfile];
}else{
 // @ts-expect-error Non-VERIFIED cannot expose a completed Mapping.
 const completed:NonNullable<NormalMappingResult['mapping']>=result.mapping;
 void completed;
}
// @ts-expect-error Public entrypoint has no intermediate-evidence argument.
mapNormal(input,{status:'BOUND'});
declare const source:SourceRecord;
// @ts-expect-error SOURCE inputRef cannot be BUDGET.
const badSource:SourceRecord={...source,inputRef:{kind:'BUDGET',id:'b'}};
declare const scope:Scope;
// @ts-expect-error SCOPE inputRef cannot be SOURCE.
const badScope:Scope={...scope,inputRef:{kind:'SOURCE',id:'s'}};
void [badSource,badScope];
