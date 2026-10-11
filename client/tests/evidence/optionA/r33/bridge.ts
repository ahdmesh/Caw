// Test-only callback fault injection; the actual R30 function always runs.
import {normalizeObservationsWithSharedAux as real} from '../../../../src/evidence/optionA/observation';
export let mode='normal';
export const events:any[]=[];
export const sentinel=new Error('EXPECTED_CALLBACK_FAULT');
export function setup(next:string){mode=next;events.length=0;}
export function normalizeObservationsWithSharedAux(input:any,cb:any){
 let count=0;
 return real(input,{
  reserveAux(bytes:number){
   count++;
   if(mode==='reserveThrow'&&count===2){events.push({op:'reserve',bytes,result:'THROW'});throw sentinel;}
   const result=cb.reserveAux(bytes);events.push({op:'reserve',bytes,result});return result;
  },
  releaseUnusedAux(bytes:number){
   if(mode==='invalidRelease'){events.push({op:'release',bytes:-1});return cb.releaseUnusedAux(-1);}
   cb.releaseUnusedAux(bytes);events.push({op:'release',bytes});
   if(mode==='doubleRelease'){events.push({op:'release',bytes,double:true});cb.releaseUnusedAux(bytes);}
   if(mode==='releaseThrow'){events.push({op:'throwAfterRelease'});throw sentinel;}
  }
 });
}
