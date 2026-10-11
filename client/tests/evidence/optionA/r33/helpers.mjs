import assert from "node:assert/strict";
function snapshot(root) {
  const objects = new Map();
  function visit(v) {
    if (v === null || typeof v !== "object" || objects.has(v)) return;
    const keys = Reflect.ownKeys(v);
    const descriptors = keys.map(k => [k, Object.getOwnPropertyDescriptor(v,k)]);
    objects.set(v, {prototype:Object.getPrototypeOf(v), frozen:Object.isFrozen(v), descriptors});
    for (const [,d] of descriptors) if ("value" in d) visit(d.value);
  }
  visit(root);
  return objects;
}
function verifyInputUnchanged(input, before) {
  const after=snapshot(input);
  assert.equal(after.size,before.size,"input object graph changed");
  for(const [object,old] of before) {
    const current=after.get(object);
    assert.ok(current,"input object replaced");
    assert.ok(Object.is(current.prototype,old.prototype),"input prototype changed");
    assert.equal(current.frozen,old.frozen,"input frozen state changed");
    assert.equal(current.descriptors.length,old.descriptors.length,"input property count changed");
    for(let i=0;i<old.descriptors.length;i++) {
      const [oldKey,oldDescriptor]=old.descriptors[i];
      const [key,descriptor]=current.descriptors[i];
      assert.ok(Object.is(key,oldKey),"input key changed");
      for(const field of ["value","get","set","writable","enumerable","configurable"]) {
        assert.equal(Object.hasOwn(descriptor,field),Object.hasOwn(oldDescriptor,field),"descriptor kind changed");
        assert.ok(Object.is(descriptor[field],oldDescriptor[field]),"input descriptor changed: "+String(key)+"."+field);
      }
    }
  }
}
function verifyOutput(root, inputs) {
  const visited = new Set();
  function visit(v) {
    if (v === null || typeof v !== "object" || visited.has(v)) return;
    visited.add(v);
    assert.ok(!inputs.has(v), "output/input mutable alias");
    assert.ok(Object.isFrozen(v), "output not deeply frozen");
    for (const k of Reflect.ownKeys(v)) {
      const d = Object.getOwnPropertyDescriptor(v,k);
      assert.ok("value" in d, "output accessor");
      visit(d.value);
    }
  }
  visit(root);
}
function accounting(result) {
  const d = result.diagnostics.find(x=>x.reasonCode==="OBSERVATION_ACCOUNTING");
  assert.ok(d,"accounting summary missing");
  const m = /^inputBytes=(\d+);auxiliaryBytes=(\d+);normalizedRecords=(\d+);omittedKnownDiagnostics=(\d+)$/.exec(d.message);
  assert.ok(m,"invalid accounting summary");
  const [inputBytes,auxiliaryBytes,normalizedRecords,omittedKnownDiagnostics]=m.slice(1).map(Number);
  assert.ok(inputBytes<=8388608 && auxiliaryBytes<=33554432);
  assert.ok(auxiliaryBytes>=65536);
  return {inputBytes,auxiliaryBytes,normalizedRecords,omittedKnownDiagnostics};
}


export {snapshot,verifyInputUnchanged,verifyOutput,accounting};
