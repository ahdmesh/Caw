const a=(sender=10,nonce=7,network=1)=>({sender,nonce,network});
export const fixtures=[
 {id:'A01',actions:[a()],sizes:[1],status:'ASSOCIATED'},
 {id:'A02',actions:[a(10,7),a(20,50),a(20,51),a(30,3)],sizes:[1,2,1],status:'ASSOCIATED'},
 {id:'A03',actions:[a(),a(11,8)],sizes:[2],status:'CONTRADICTED',reason:'NORMAL_GROUP_SENDER_MISMATCH'},
 {id:'A04',actions:[a(),a(10,9)],sizes:[2],status:'CONTRADICTED',reason:'NORMAL_GROUP_CAWONCE_MISMATCH'},
 {id:'A05',actions:[a(10,4294967295),a(10,0)],sizes:[2],status:'CONTRADICTED',reason:'NORMAL_GROUP_CAWONCE_MISMATCH'},
 {id:'A06',actions:[a(10,7),a(20,7)],sizes:[1,1],status:'ASSOCIATED'},
 {id:'A07',actions:[a(10,7),a(10,99)],sizes:[1,1],status:'ASSOCIATED'},
 {id:'A08',actions:[a(),a(20,3,2)],sizes:[1,1],status:'CONTRADICTED',reason:'NORMAL_CALL_NETWORK_MISMATCH'},
 {id:'A09',actions:[a(),a(10,8,2)],sizes:[2],status:'CONTRADICTED',reason:'NORMAL_CALL_NETWORK_MISMATCH'},
 {id:'A10',actions:[a()],sizes:[1],reject:1,status:'RESOURCE_LIMIT',reason:'NORMAL_ASSOCIATION_AUXILIARY_LIMIT'},
 {id:'A11',actions:[a()],sizes:[1],capture:'PARTIAL',status:'INSUFFICIENT',reason:'NORMAL_ASSOCIATION_CAPTURE_NOT_FULL'},
 {id:'A12',actions:[a()],sizes:[1],short:true,status:'UNSUPPORTED',reason:'NORMAL_SHORT_SIGNATURE_READ_UNSUPPORTED'},
 {id:'A10-SIGNATURE',actions:[a()],sizes:[1],reject:2,status:'RESOURCE_LIMIT',reason:'SIGNATURE_AUXILIARY_LIMIT'},
 {id:'A10-OUTPUT',actions:[a()],sizes:[1],reject:3,status:'RESOURCE_LIMIT',reason:'NORMAL_ASSOCIATION_AUXILIARY_LIMIT'}
];
export function packed(actions){
 const b=new Uint8Array(2+25*actions.length),v=new DataView(b.buffer);v.setUint16(0,actions.length);
 actions.forEach((a,i)=>{const o=2+25*i;b[o]=1;v.setUint32(o+1,a.sender);v.setUint32(o+5,123);v.setUint32(o+9,0);v.setUint32(o+13,a.network);v.setUint32(o+17,a.nonce);});return b;
}
export function sigs(sizes,short=false){
 const u16=x=>x.toString(16).padStart(4,'0');let s='0x'+u16(sizes.length);
 sizes.forEach((n,i)=>{s+=u16(n)+(27+i).toString(16).padStart(2,'0')+(i+1).toString(16).padStart(2,'0').repeat(32)+(i+17).toString(16).padStart(2,'0').repeat(32);});return short?s.slice(0,-2):s;
}
