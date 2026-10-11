import {mapNormal} from '../../../../src/evidence/optionA/index';
import type {MappingInput, NormalMappingResult, SourceRecord, Scope} from '../../../../src/evidence/optionA/types';
declare const input:MappingInput;
const result:NormalMappingResult=mapNormal(input);
if(result.status==='VERIFIED'){
 const profile:'NORMAL'=result.mapping.profile;
 const outcome:'HAS_SUCCESS'=result.mapping.outcomeKind;
 const exactlyOne:1=result.mapping.commitment.events.length;
 const wrongProfile:'SAFE'=result.mapping.profile;
 void [profile,outcome,exactlyOne,wrongProfile];
}else{
 const completed:NonNullable<NormalMappingResult['mapping']>=result.mapping;
 void completed;
}
mapNormal(input,{status:'BOUND'});
declare const source:SourceRecord;
const badSource:SourceRecord={...source,inputRef:{kind:'BUDGET',id:'b'}};
declare const scope:Scope;
const badScope:Scope={...scope,inputRef:{kind:'SOURCE',id:'s'}};
void [badSource,badScope];
