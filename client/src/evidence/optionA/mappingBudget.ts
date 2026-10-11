import type {ObservationInput, ObservationResult, NonVerifiedResult} from "./types";
import {normalizeObservationsWithSharedAux} from "./observation";

// Internal only. No public API/barrel export and no Mapping VERIFIED.
const AUX_LIMIT = 33554432;
const MAPPING_CONTROL = 16384;
// Logical model: 32 scalar/capture slots; <=8 objects of <=16 fields;
// <=8 arrays of <=16 references; <=16 new strings of <=192 code units.
// Includes state, callback/API closures' logical captures, both stop
// envelopes, diagnostics, empty metadata, and the returned gate wrapper.
// Existing frozen Observation metadata is referenced, never recopied.
// Engine function bodies, Error internals and heap/RSS are not modeled.
const CONTROL_ACCOUNTED =
  32 * 16 + 8 * (16 + 16 * 16) + 8 * (16 + 16 * 8) +
  16 * (8 + 2 * 192) + 768; // input lifecycle plus post-Observation evidence stop method/capture
const EMPTY = Object.freeze([]);
const NO_VERSIONS = Object.freeze({abi:"", rules:"", budget:""});
const UNCHECKED = Object.freeze([
  Object.freeze({code:"PROFILE_VERSIONS_UNAVAILABLE_EMPTY_PLACEHOLDERS",inputRefs:EMPTY}),
  Object.freeze({code:"REMAINING_VALIDATION_NOT_ASSESSED",inputRefs:EMPTY}),
  Object.freeze({code:"RECEIPT_MAPPING_COMMITMENT_NOT_ASSESSED",inputRefs:EMPTY}),
]);

type Phase = "ACTIVE" | "STOPPED" | "ABORTED";
type Gate =
  | {readonly kind:"OBSERVATION_READY"; readonly observation:ObservationResult}
  | {readonly kind:"STOP"; readonly result:NonVerifiedResult<"MAPPING">};

/** One Mapping call. Already-accounted owned Observation input only.
 * No logical-input charging here: Mapping's full schema accounting is
 * a separate prerequisite. All real Observation copies remain charged.
 * This is not mapNormal() and cannot return Mapping VERIFIED.
 */
export function createMappingBudgetBoundary() {
  if (CONTROL_ACCOUNTED > MAPPING_CONTROL || MAPPING_CONTROL > AUX_LIMIT) {
    throw new Error("Mapping control accounting invariant");
  }
  // Logical charge precedes per-call objects/closures/envelopes.
  let used = MAPPING_CONTROL;
  let phase:Phase = "ACTIVE";
  let rejected = false;
  let running = false;
  let observationCalled = false;
  let refundableReservation = 0;
  let lastObservation: ObservationResult | null = null;

  const initialStop:NonVerifiedResult<"MAPPING"> = Object.freeze({
    operation:"MAPPING",status:"RESOURCE_LIMIT",
    reasonCode:"OBSERVATION_CONTROL_RESERVATION_DENIED",
    diagnostics:Object.freeze([Object.freeze({
      reasonCode:"OBSERVATION_CONTROL_RESERVATION_DENIED",
      message:"OBSERVATION_CONTROL_RESERVATION_DENIED",inputRefs:EMPTY,sourceRefs:EMPTY,
    })]),
    versions:NO_VERSIONS,checked:EMPTY,unchecked:UNCHECKED,
    inputRefs:EMPTY,provenance:EMPTY,
    verificationScope:"PROVIDED_EVIDENCE_ONLY",canonicality:"NOT_ASSESSED",finality:"NOT_ASSESSED",
  });
  const initialGate:Gate = Object.freeze({kind:"STOP",result:initialStop});

  function isAborted():boolean { return phase === "ABORTED"; }
  function abort():never {
    phase="ABORTED";
    throw new Error("Mapping budget internal contract violation");
  }
  function reserve(bytes:number):boolean {
    if (phase!=="ACTIVE" || !Number.isSafeInteger(bytes) || bytes<0) return abort();
    refundableReservation=0;
    if (bytes>AUX_LIMIT-used) {
      rejected=true;phase="STOPPED";return false;
    }
    used+=bytes;
    return true;
  }
  const callbacks=Object.freeze({
    reserveAux(bytes:number):boolean {
      if (!running) return abort();
      const accepted=reserve(bytes);
      if (accepted) refundableReservation=bytes;
      return accepted;
    },
    releaseUnusedAux(bytes:number):void {
      if (!running || phase!=="ACTIVE" || !Number.isSafeInteger(bytes) || bytes<=0 ||
          bytes%2!==0 || bytes>refundableReservation-10 || bytes>used-MAPPING_CONTROL) {
        return abort();
      }
      // Only R30 identityKey calls this: latest reservation is 8+2*N;
      // N>=1, actual length>=1. R30 proves the unused-character amount.
      // Not a generic deallocator. Never hand these callbacks elsewhere.
      refundableReservation=0; // one release per reservation
      used-=bytes;
    },
  });

  return Object.freeze({
    get observationResult():ObservationResult|null {return lastObservation;},
    get usedAux():number {return used;},
    get phase():Phase {return phase;},
    get sharedRejected():boolean {return rejected;},
    reserveAux(bytes:number):boolean {
      if (running) return abort();
      return reserve(bytes);
    },
    // Internal owned-input boundary only; result is already frozen/charged.
    stopInput(result:NonVerifiedResult<"MAPPING">) {
      if (phase==="ABORTED" || running || observationCalled) return abort();
      phase="STOPPED";
      return result;
    },
    // R36 internal only. Frozen result/control capacity is caller-reserved.
    stopEvidence(result:NonVerifiedResult<"MAPPING">) {
      if (phase==="ABORTED" || running || (result as {status:string}).status==="VERIFIED") return abort();
      phase="STOPPED";return result;
    },
    abortInput(error:unknown):never {
      phase="ABORTED";throw error;
    },
    observe(input:ObservationInput, deferOrdinaryFailure = false):Gate {
      if (phase!=="ACTIVE" || running || observationCalled) return abort();
      observationCalled=true;running=true;
      try {
        const result=normalizeObservationsWithSharedAux(input,callbacks);
        // Callback may have changed phase; read through a function for TS control-flow.
        if (isAborted()) return abort();
        lastObservation=result;
        if (result===null) {
          if (!rejected) return abort();
          return initialGate;
        }
        const locallyStopped=result.unchecked.some(
          range=>range.code==="REMAINING_VALIDATION_NOT_ASSESSED",
        );
        if (rejected || locallyStopped || result.status!=="VERIFIED") {
          const stopped=rejected||locallyStopped;
          if (stopped || !deferOrdinaryFailure) phase="STOPPED";
          const status=result.status==="CONTRADICTED" ? "CONTRADICTED" :
            stopped ? "RESOURCE_LIMIT" : result.status;
          if (status==="VERIFIED") return abort();
          const mapped:NonVerifiedResult<"MAPPING">=Object.freeze({
            operation:"MAPPING",status,reasonCode:result.reasonCode,
            diagnostics:result.diagnostics,versions:result.versions,
            checked:result.checked,unchecked:result.unchecked,
            inputRefs:result.inputRefs,provenance:result.provenance,
            verificationScope:result.verificationScope,
            canonicality:result.canonicality,finality:result.finality,
          });
          return Object.freeze({kind:"STOP",result:mapped});
        }
        return Object.freeze({kind:"OBSERVATION_READY",observation:result});
      } catch(error:unknown) {
        phase="ABORTED";throw error;
      } finally {
        running=false;refundableReservation=0;
      }
    },
  });
}
