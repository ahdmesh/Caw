import type {
  Address,
  AssessmentRange,
  Diagnostic,
  Hash32,
  HexBytes,
  InputReference,
  Observation,
  ObservationInput,
  ObservationResult,
  ProfileVersions,
  Provenance,
  ProvenanceRef,
  SourceIdentity,
  SourceRecord,
} from "./types";
import { matchProfile } from "./profile";

/**
 * Initial source draft. Not compiled or executed.
 *
 * Input boundary:
 * - ordinary data objects and arrays;
 * - required schema fields must be own data properties;
 * - getters are not invoked;
 * - arbitrary Proxy objects and modified built-ins are outside scope.
 *
 * Unknown fields are not traversed or copied.
 *
 * PRB-R12 logical accounting is not a JS heap/RSS bound.
 */

const INPUT_LIMIT = 8388608;
const AUX_LIMIT = 33554432;
const SOURCE_LIMIT = 4096;
const TOPIC_LIMIT = 4;
const DIAGNOSTIC_LIMIT = 32;

/**
 * Fixed logical reservations; not engine heap/RSS bounds.
 * State: 17 fields, four initial arrays, two identity-cache maps,
 * unavailable versions, and STOP.
 * Diagnostics: 32 slots; two strings of at most 192 code units each.
 * Assessment: at most ten ranges; each code at most 96 code units.
 * Finish: metadata, result, and at most sixteen summary temporaries.
 * Scratch: sixteen live frames, each with 32 scalar/reference slots,
 * one data descriptor, 32 iterator slots, a bounded index key,
 * and one temporary closed-schema object.
 * Profile matching: bounded temporary descriptors/result/field text.
 *
 * Static schema/literal/profile definitions are pre-existing constants.
 * VM internals, GC and native allocation are outside this logical model.
 */
const CONTROL_RESERVE = 65536;
const CONTROL_ACCOUNTED =
  (16 + 17 * 16) + 4 * 16 + 2 * 16 + (16 + 3 * 16) + 16 +
  (16 + 32 * (8 + (16 + 4 * 16) + 2 * 16 + 2 * (8 + 2 * 192))) +
  2 * 16 + 10 * (8 + (16 + 2 * 16) + 16 + (8 + 2 * 96)) +
  (16 + 11 * 16) + (16 + 14 * 16) +
  16 * (8 + 2 * 192) +
  16 * (32 * 8 + (16 + 4 * 16) + 32 * 8 + 64 + 64) +
  2048;

const STOP = Object.freeze({});

/**
 * This is a closed description of ObservationInput only.
 * It is not exported or configurable by callers.
 */
type Shape =
  | "string"
  | "number"
  | "bigint"
  | { readonly nullable: Shape }
  | { readonly array: Shape; readonly max?: number }
  | { readonly fields: Readonly<Record<string, Shape>> };

const nullableString: Shape = { nullable: "string" };
const nullableNumber: Shape = { nullable: "number" };
const nullableBigint: Shape = { nullable: "bigint" };

const inputRefShape: Shape = {
  fields: { kind: "string", id: "string" },
};

const provenanceRefShape: Shape = {
  fields: { id: "string" },
};

const provenanceRefsShape: Shape = {
  array: provenanceRefShape,
};

const versionsShape: Shape = {
  fields: {
    abi: "string",
    rules: "string",
    budget: "string",
  },
};

const scopeShape: Shape = {
  fields: {
    inputRef: inputRefShape,
    expectedChainId: "bigint",
    normalEmitter: "string",
    erc1271Emitter: nullableString,
    versions: versionsShape,
    provenance: provenanceRefsShape,
  },
};

const budgetShape: Shape = {
  fields: {
    inputRef: inputRefShape,
    version: "string",

    maxCalldataBytes: "number",
    maxPackedActionBytes: "number",
    maxLogicalInputBytes: "number",

    maxReceiptLogs: "number",
    maxSourceRecords: "number",
    maxLogTopics: "number",

    maxNormalSafeActions: "number",
    maxNormalSafeGroups: "number",

    maxERC1271Groups: "number",
    maxERC1271Actions: "number",
    maxERC1271GroupSize: "number",

    maxSafeDPStates: "number",
    maxSafeDPWorkUnits: "number",
    maxReasonByteComparisons: "number",

    maxAuxiliaryBufferBytes: "number",
    maxDiagnostics: "number",

    provenance: provenanceRefsShape,
  },
};

const sourceShape: Shape = {
  fields: {
    inputRef: inputRefShape,
    chainId: nullableBigint,
    blockHash: nullableString,
    blockNumber: nullableBigint,
    transactionHash: nullableString,
    transactionIndex: nullableNumber,
    sourceLogIndex: nullableNumber,
    emitter: nullableString,
    topics: {
      nullable: {
        array: "string",
        max: TOPIC_LIMIT,
      },
    },
    data: nullableString,
    provenance: provenanceRefsShape,
  },
};

const provenanceShape: Shape = {
  fields: {
    id: "string",
    method: "string",
    provider: "string",
    acquisitionScope: "string",
    capture: "string",
    captureTime: nullableString,
    description: nullableString,
  },
};

type FailureStatus =
  | "CONTRADICTED"
  | "RESOURCE_LIMIT"
  | "UNSUPPORTED"
  | "INSUFFICIENT";

const PRIORITY: Readonly<Record<FailureStatus, number>> = {
  CONTRADICTED: 0,
  RESOURCE_LIMIT: 1,
  UNSUPPORTED: 2,
  INSUFFICIENT: 3,
};

/** Internal Mapping seam; do not re-export from the public API.
 * The owner supplies trusted synchronous, non-reentrant callbacks.
 * reserveAux is atomic: true charges once; false charges nothing and
 * latches Mapping resource exhaustion. No input is inspected by callbacks.
 * releaseUnusedAux returns only this call's unused reservation; it must
 * reject underflow/double release and must not throw on valid releases.
 * Callback storage and Mapping's failure envelope are reserved by Mapping.
 */
interface SharedAuxReservation {
  reserveAux(bytes: number): boolean;
  releaseUnusedAux(bytes: number): void;
}

interface State {
  sharedAux: SharedAuxReservation | null;
  inputBytes: number;
  auxiliaryBytes: number;
  status: FailureStatus | null;
  reason: string;
  diagnostics: Diagnostic[];
  omittedDiagnostics: number;
  stopped: boolean;
  inputComplete: boolean;
  normalizedCount: number;
  versions: ProfileVersions;
  versionsCopied: boolean;
  profileMatched: boolean;
  chainMagnitudeBytes: Map<bigint, number>;
  chainDecimal: Map<bigint, string>;
  inputRefs: InputReference[];
  provenance: Provenance[];
}

function addIssue(
  state: State,
  status: FailureStatus,
  reason: string,
): void {
  if (reason.length > 192) {
    throw new Error("Diagnostic control reservation invariant violated");
  }

  if (
    state.status === null ||
    PRIORITY[status] < PRIORITY[state.status]
  ) {
    state.status = status;
    state.reason = reason;
  }

  // One slot remains available for a final bounded summary.
  if (state.diagnostics.length < DIAGNOSTIC_LIMIT - 1) {
    state.diagnostics.push({
      reasonCode: reason,
      message: reason,
      inputRefs: [],
      sourceRefs: [],
    });
  } else {
    if (state.omittedDiagnostics === Number.MAX_SAFE_INTEGER) {
      throw new Error("Diagnostic counter invariant violated");
    }
    state.omittedDiagnostics += 1;
  }
}

function stop(
  state: State,
  status: FailureStatus,
  reason: string,
): never {
  addIssue(state, status, reason);
  state.stopped = true;
  throw STOP;
}

function reserveAux(state: State, bytes: number): void {
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    bytes > AUX_LIMIT - state.auxiliaryBytes
  ) {
    stop(state, "RESOURCE_LIMIT", "AUXILIARY_BUDGET_EXCEEDED");
  }

  if (state.sharedAux !== null && !state.sharedAux.reserveAux(bytes)) {
    stop(state, "RESOURCE_LIMIT", "AUXILIARY_BUDGET_EXCEEDED");
  }

  state.auxiliaryBytes += bytes;
}

// Only identityKey's two proven string-overestimate refunds use this.
function releaseUnusedAux(state: State, bytes: number): void {
  if (
    !Number.isSafeInteger(bytes) || bytes < 0 ||
    bytes > state.auxiliaryBytes - CONTROL_RESERVE
  ) {
    throw new Error("Unused reservation invariant violated");
  }
  if (bytes === 0) return;
  if (state.sharedAux !== null) state.sharedAux.releaseUnusedAux(bytes);
  state.auxiliaryBytes -= bytes;
}

function addInput(state: State, bytes: number): void {
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    bytes > INPUT_LIMIT - state.inputBytes
  ) {
    stop(state, "RESOURCE_LIMIT", "INPUT_BUDGET_EXCEEDED");
  }

  state.inputBytes += bytes;
}

function reserveScaled(
  state: State,
  base: number,
  count: number,
  width: number,
): void {
  const remaining = AUX_LIMIT - state.auxiliaryBytes;

  if (
    !Number.isSafeInteger(count) ||
    count < 0 ||
    base > remaining ||
    count > Math.floor((remaining - base) / width)
  ) {
    stop(state, "RESOURCE_LIMIT", "AUXILIARY_BUDGET_EXCEEDED");
  }

  reserveAux(state, base + count * width);
}

function ownValue(state: State, value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);

  if (descriptor === undefined || !("value" in descriptor)) {
    stop(state, "CONTRADICTED", "REQUIRED_DATA_PROPERTY_INVALID");
  }

  return descriptor.value;
}

/**
 * Counts UTF-8 without producing an encoded buffer.
 * Lone surrogates count as the replacement character: three bytes.
 */
function countString(state: State, value: string): void {
  addInput(state, 5);

  // Every UTF-16 code unit requires at least one UTF-8 byte.
  if (value.length > INPUT_LIMIT - state.inputBytes) {
    stop(state, "RESOURCE_LIMIT", "INPUT_BUDGET_EXCEEDED");
  }

  for (let i = 0; i < value.length; i += 1) {
    const first = value.charCodeAt(i);

    if (first <= 0x7f) {
      addInput(state, 1);
    } else if (first <= 0x7ff) {
      addInput(state, 2);
    } else if (
      first >= 0xd800 &&
      first <= 0xdbff &&
      i + 1 < value.length
    ) {
      const second = value.charCodeAt(i + 1);

      if (second >= 0xdc00 && second <= 0xdfff) {
        addInput(state, 4);
        i += 1;
      } else {
        addInput(state, 3);
      }
    } else {
      addInput(state, 3);
    }
  }
}

/**
 * Creates a bounded comparison threshold after reserving its
 * logical capacity. Reservations are conservatively cumulative.
 */
function threshold(state: State, bytes: number): bigint {
  reserveAux(state, 32 + bytes + 1);
  return 1n << BigInt(bytes * 8);
}

function countBigint(
  state: State,
  value: bigint,
  rememberChainMagnitude: boolean,
): void {
  // All bigint fields in ObservationInput are nonnegative.
  if (value < 0n) {
    stop(state, "CONTRADICTED", "NEGATIVE_BIGINT");
  }

  addInput(state, 6);

  if (rememberChainMagnitude) {
    const cached = state.chainMagnitudeBytes.get(value);
    if (cached !== undefined) {
      addInput(state, cached);
      return;
    }
  }

  if (value === 0n) {
    if (rememberChainMagnitude) {
      reserveAux(state, 64 + 8);
      state.chainMagnitudeBytes.set(value, 0);
    }
    return;
  }

  const available = INPUT_LIMIT - state.inputBytes;

  if (available === 0) {
    stop(state, "RESOURCE_LIMIT", "INPUT_BUDGET_EXCEEDED");
  }

  let lower = 0;
  let upper = 1;

  while (value >= threshold(state, upper)) {
    lower = upper;

    if (upper === available) {
      stop(state, "RESOURCE_LIMIT", "INPUT_BUDGET_EXCEEDED");
    }

    upper = Math.min(available, upper * 2);
  }

  while (upper - lower > 1) {
    const middle = lower + Math.floor((upper - lower) / 2);

    if (value < threshold(state, middle)) {
      upper = middle;
    } else {
      lower = middle;
    }
  }

  addInput(state, upper);
  if (rememberChainMagnitude) {
    // Entry plus retained bigint capacity; input occurrences still count.
    reserveAux(state, 64 + 8 + upper);
    state.chainMagnitudeBytes.set(value, upper);
  }
}

function copyValue(
  state: State,
  value: unknown,
  shape: Shape,
  rememberChainMagnitude = false,
): unknown {
  if (typeof shape === "string") {
    if (typeof value !== shape) {
      stop(state, "CONTRADICTED", "INPUT_TYPE_INVALID");
    }

    if (shape === "string") {
      const text = value as string;
      countString(state, text);
      reserveScaled(state, 8, text.length, 2);
      return text;
    }

    if (shape === "number") {
      const number = value as number;

      if (!Number.isFinite(number)) {
        stop(state, "CONTRADICTED", "NONFINITE_NUMBER");
      }

      addInput(state, 9);
      return number;
    }

    const integer = value as bigint;
    countBigint(state, integer, rememberChainMagnitude);
    return integer;
  }

  if ("nullable" in shape) {
    if (value === null) {
      addInput(state, 1);
      return null;
    }

    return copyValue(state, value, shape.nullable, rememberChainMagnitude);
  }

  if ("array" in shape) {
    if (!Array.isArray(value)) {
      stop(state, "CONTRADICTED", "ARRAY_REQUIRED");
    }

    const length = ownValue(state, value, "length");

    if (
      typeof length !== "number" ||
      !Number.isSafeInteger(length) ||
      length < 0
    ) {
      stop(state, "CONTRADICTED", "ARRAY_LENGTH_INVALID");
    }

    if (shape.max !== undefined && length > shape.max) {
      stop(state, "RESOURCE_LIMIT", "ARRAY_COUNT_EXCEEDED");
    }

    addInput(state, 5);
    reserveScaled(state, 16, length, 8);

    const result: unknown[] = [];

    for (let i = 0; i < length; i += 1) {
      result.push(
        copyValue(state, ownValue(state, value, String(i)), shape.array),
      );
    }

    return result;
  }

  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    stop(state, "CONTRADICTED", "OBJECT_REQUIRED");
  }

  let fields = 0;

  for (const key in shape.fields) {
    if (Object.prototype.hasOwnProperty.call(shape.fields, key)) {
      fields += 1;
    }
  }

  addInput(state, 5);
  reserveScaled(state, 16, fields, 16);

  const result: Record<string, unknown> = {};

  for (const key in shape.fields) {
    if (!Object.prototype.hasOwnProperty.call(shape.fields, key)) {
      continue;
    }

    countString(state, key);
    result[key] = copyValue(
      state,
      ownValue(state, value, key),
      shape.fields[key]!,
      shape === sourceShape && key === "chainId",
    );
  }

  return result;
}

function copyInput(
  state: State,
  input: ObservationInput,
): ObservationInput {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input)
  ) {
    stop(state, "CONTRADICTED", "OBSERVATION_INPUT_INVALID");
  }

  // Lightweight count check before traversal or copying.
  const rawSources = ownValue(state, input, "sources");

  if (!Array.isArray(rawSources)) {
    stop(state, "CONTRADICTED", "SOURCES_ARRAY_REQUIRED");
  }

  const sourceCount = ownValue(state, rawSources, "length");

  if (typeof sourceCount !== "number" || sourceCount > SOURCE_LIMIT) {
    stop(state, "RESOURCE_LIMIT", "SOURCE_COUNT_EXCEEDED");
  }

  addInput(state, 5);
  reserveAux(state, 80);

  countString(state, "scope");
  const scope = copyValue(
    state,
    ownValue(state, input, "scope"),
    scopeShape,
  ) as ObservationInput["scope"];

  // These are already copied and fully counted.
  state.versions = scope.versions;
  state.versionsCopied = true;

  countString(state, "budget");
  const budget = copyValue(
    state,
    ownValue(state, input, "budget"),
    budgetShape,
  ) as ObservationInput["budget"];

  countString(state, "sources");
  const sources = copyValue(state, rawSources, {
    array: sourceShape,
    max: SOURCE_LIMIT,
  }) as readonly SourceRecord[];

  countString(state, "provenance");
  const provenance = copyValue(
    state,
    ownValue(state, input, "provenance"),
    { array: provenanceShape },
  ) as readonly Provenance[];

  state.inputComplete = true;

  return { scope, budget, sources, provenance };
}

function validOrdinal(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function normalizeHex(
  state: State,
  value: string | null,
  byteLength: number | null,
): HexBytes | null {
  if (value === null) {
    addIssue(state, "INSUFFICIENT", "REQUIRED_CONTEXT_MISSING");
    return null;
  }

  if (
    !value.startsWith("0x") ||
    value.length % 2 !== 0 ||
    (byteLength !== null && value.length !== 2 + byteLength * 2)
  ) {
    addIssue(state, "CONTRADICTED", "HEX_FORMAT_INVALID");
    return null;
  }

  for (let i = 2; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    const valid =
      (c >= 48 && c <= 57) ||
      (c >= 65 && c <= 70) ||
      (c >= 97 && c <= 102);

    if (!valid) {
      addIssue(state, "CONTRADICTED", "HEX_FORMAT_INVALID");
      return null;
    }
  }

  reserveScaled(state, 8, value.length, 2);
  return value.toLowerCase() as HexBytes;
}

function normalizeSource(
  state: State,
  source: SourceRecord,
): SourceRecord {
  let chainId = source.chainId;
  let blockNumber = source.blockNumber;
  let transactionIndex = source.transactionIndex;
  let sourceLogIndex = source.sourceLogIndex;

  if (chainId === null) {
    addIssue(state, "INSUFFICIENT", "CHAIN_ID_MISSING");
  } else if (chainId <= 0n) {
    addIssue(state, "CONTRADICTED", "CHAIN_ID_INVALID");
    chainId = null;
  }

  if (blockNumber === null) {
    addIssue(state, "INSUFFICIENT", "BLOCK_NUMBER_MISSING");
  } else if (blockNumber < 0n) {
    addIssue(state, "CONTRADICTED", "BLOCK_NUMBER_INVALID");
    blockNumber = null;
  }

  if (transactionIndex === null) {
    addIssue(state, "INSUFFICIENT", "TRANSACTION_INDEX_MISSING");
  } else if (!validOrdinal(transactionIndex)) {
    addIssue(state, "CONTRADICTED", "TRANSACTION_INDEX_INVALID");
    transactionIndex = null;
  }

  if (sourceLogIndex === null) {
    addIssue(state, "INSUFFICIENT", "SOURCE_LOG_INDEX_MISSING");
  } else if (!validOrdinal(sourceLogIndex)) {
    addIssue(state, "CONTRADICTED", "SOURCE_LOG_INDEX_INVALID");
    sourceLogIndex = null;
  }

  const blockHash = normalizeHex(state, source.blockHash, 32);
  const transactionHash = normalizeHex(state, source.transactionHash, 32);
  const emitter = normalizeHex(state, source.emitter, 20);
  const data = normalizeHex(state, source.data, null);

  let topics: HexBytes[] | null = null;

  if (source.topics === null) {
    addIssue(state, "INSUFFICIENT", "TOPICS_MISSING");
  } else {
    reserveScaled(state, 16, source.topics.length, 8);
    const values: HexBytes[] = [];
    let valid = true;

    for (const topic of source.topics) {
      const normalized = normalizeHex(state, topic, 32);

      if (normalized === null) {
        valid = false;
      } else {
        values.push(normalized);
      }
    }

    if (valid) {
      topics = values;
    }
  }

  reserveAux(state, 16 + 11 * 16);

  return {
    inputRef: source.inputRef,
    chainId,
    blockHash,
    blockNumber,
    transactionHash,
    transactionIndex,
    sourceLogIndex,
    emitter,
    topics,
    data,
    provenance: source.provenance,
  };
}

function sameTopics(
  left: readonly HexBytes[],
  right: readonly HexBytes[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }

  return true;
}

function knownConflict(left: SourceRecord, right: SourceRecord): boolean {
  return (
    (left.blockNumber !== null &&
      right.blockNumber !== null &&
      left.blockNumber !== right.blockNumber) ||
    (left.transactionHash !== null &&
      right.transactionHash !== null &&
      left.transactionHash !== right.transactionHash) ||
    (left.transactionIndex !== null &&
      right.transactionIndex !== null &&
      left.transactionIndex !== right.transactionIndex) ||
    (left.emitter !== null &&
      right.emitter !== null &&
      left.emitter !== right.emitter) ||
    (left.data !== null &&
      right.data !== null &&
      left.data !== right.data) ||
    (left.topics !== null &&
      right.topics !== null &&
      !sameTopics(left.topics, right.topics))
  );
}

function sameSourceContent(left: SourceRecord, right: SourceRecord): boolean {
  return (
    left.chainId === right.chainId &&
    left.blockHash === right.blockHash &&
    left.sourceLogIndex === right.sourceLogIndex &&
    left.blockNumber === right.blockNumber &&
    left.transactionHash === right.transactionHash &&
    left.transactionIndex === right.transactionIndex &&
    left.emitter === right.emitter &&
    left.data === right.data &&
    (
      left.topics === null
        ? right.topics === null
        : right.topics !== null && sameTopics(left.topics, right.topics)
    )
  );
}

function sameProvenance(left: Provenance, right: Provenance): boolean {
  return (
    left.id === right.id &&
    left.method === right.method &&
    left.provider === right.provider &&
    left.acquisitionScope === right.acquisitionScope &&
    left.capture === right.capture &&
    left.captureTime === right.captureTime &&
    left.description === right.description
  );
}

function checkReference(
  state: State,
  reference: InputReference,
  kind: InputReference["kind"],
): void {
  if (reference.kind !== kind || reference.id.length === 0) {
    addIssue(state, "CONTRADICTED", "INPUT_REFERENCE_INVALID");
  }
}

function checkProvenanceRefs(
  state: State,
  refs: readonly ProvenanceRef[],
  records: ReadonlyMap<string, Provenance>,
): void {
  if (refs.length === 0) {
    addIssue(state, "INSUFFICIENT", "PROVENANCE_MISSING");
  }

  for (const ref of refs) {
    if (ref.id.length === 0) {
      addIssue(state, "CONTRADICTED", "PROVENANCE_REFERENCE_INVALID");
    } else if (!records.has(ref.id)) {
      addIssue(state, "INSUFFICIENT", "PROVENANCE_REFERENCE_UNRESOLVED");
    }
  }
}

/**
 * Each chain magnitude was counted while copying its SourceRecord.
 * For b bytes, 3*b+1 safely bounds its decimal digit count.
 * Cached strings and lengths are per-call; duplicate input still counts.
 */
function identityKey(
  state: State,
  identity: SourceIdentity,
): string {
  let chain = state.chainDecimal.get(identity.chainId);

  if (chain === undefined) {
    const bytes = state.chainMagnitudeBytes.get(identity.chainId);
    if (
      bytes === undefined ||
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      bytes > INPUT_LIMIT
    ) {
      throw new Error("Chain magnitude accounting invariant violated");
    }

    const decimalBound = bytes * 3 + 1;
    reserveAux(state, 64); // Decimal-cache entry; bigint already counted.
    reserveScaled(state, 8, decimalBound, 2);
    chain = identity.chainId.toString(10);

    if (chain.length > decimalBound) {
      throw new Error("Decimal reservation invariant violated");
    }

    // Release only unused reservation, not the retained string.
    releaseUnusedAux(state, 2 * (decimalBound - chain.length));
    state.chainDecimal.set(identity.chainId, chain);
  }

  reserveAux(state, 8 + 16 * 2);
  const index = identity.sourceLogIndex.toString(10);
  if (index.length > 16) {
    throw new Error("Ordinal reservation invariant violated");
  }
  releaseUnusedAux(state, 2 * (16 - index.length));

  // Fixed-order array representation; hashes contain validated hex.
  const length = chain.length + identity.blockHash.length + index.length + 10;
  reserveScaled(state, 8, length, 2);
  return `["${chain}","${identity.blockHash}","${index}"]`;
}

interface Bucket {
  readonly records: SourceRecord[];
}

function complete(source: SourceRecord): boolean {
  return (
    source.chainId !== null &&
    source.blockHash !== null &&
    source.sourceLogIndex !== null &&
    source.blockNumber !== null &&
    source.transactionHash !== null &&
    source.transactionIndex !== null &&
    source.emitter !== null &&
    source.topics !== null &&
    source.data !== null
  );
}

function deepFreezeOwned(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return;
  }

  // Only newly built, acyclic plain output objects reach this function.
  // Avoid enumerating every array key into engine enumeration metadata.
  // Output schema depth is below the sixteen reserved scratch frames.
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      deepFreezeOwned(value[i]);
    }
    Object.freeze(value);
    return;
  }

  const object = value as Record<string, unknown>;

  for (const key in object) {
    if (Object.prototype.hasOwnProperty.call(object, key)) {
      deepFreezeOwned(object[key]);
    }
  }

  Object.freeze(object);
}

function assessment(code: string): AssessmentRange {
  if (code.length > 96) {
    throw new Error("Assessment reservation invariant violated");
  }
  return { code, inputRefs: [] };
}

function finish(
  state: State,
  observations: Observation[],
): ObservationResult {
  // This bounded summary and result envelope use CONTROL_RESERVE.
  const summary =
    `inputBytes=${state.inputBytes};` +
    `auxiliaryBytes=${state.auxiliaryBytes};` +
    `normalizedRecords=${state.normalizedCount};` +
    `omittedKnownDiagnostics=${state.omittedDiagnostics}`;

  state.diagnostics.push({
    reasonCode: "OBSERVATION_ACCOUNTING",
    message: summary,
    inputRefs: [],
    sourceRefs: [],
  });

  const checked: AssessmentRange[] = [
    assessment(state.inputComplete
      ? "SCHEMA_INPUT_COUNT_COMPLETE"
      : "SCHEMA_INPUT_COUNT_PARTIAL"),
  ];

  const unchecked: AssessmentRange[] = [
    assessment("RECEIPT_MAPPING_COMMITMENT_NOT_ASSESSED"),
    assessment("CHAIN_COMPLETENESS_NOT_ASSESSED"),
    assessment("CAPTURE_SEMANTICS_NOT_ASSESSED"),
  ];

  if (state.versionsCopied) {
    checked.push(assessment("PROFILE_VERSION_FIELDS_ACQUIRED"));
  } else {
    // The empty strings are absence placeholders, not version identifiers.
    unchecked.push(assessment("PROFILE_VERSIONS_UNAVAILABLE_EMPTY_PLACEHOLDERS"));
  }

  if (state.profileMatched) {
    checked.push(assessment("REGISTERED_PROFILE_MATCHED"));
  } else {
    unchecked.push(assessment("PROFILE_ACCEPTANCE_NOT_ESTABLISHED"));
  }

  if (state.stopped) {
    unchecked.push(assessment("REMAINING_VALIDATION_NOT_ASSESSED"));
  }

  if (state.status === null) {
    if (!state.versionsCopied || !state.profileMatched) {
      throw new Error("Verified profile metadata invariant violated");
    }
    checked.push(assessment("NORMALIZATION_IDENTITY_AND_REFERENCES_COMPLETE"));
  }

  const metadata = {
    reasonCode: state.status === null
      ? "OBSERVATIONS_NORMALIZED"
      : state.reason,
    diagnostics: state.diagnostics,
    versions: state.versions,
    checked,
    unchecked,
    inputRefs: state.inputRefs,
    provenance: state.provenance,
    verificationScope: "PROVIDED_EVIDENCE_ONLY" as const,
    canonicality: "NOT_ASSESSED" as const,
    finality: "NOT_ASSESSED" as const,
  };

  const result: ObservationResult = state.status === null
    ? {
        ...metadata,
        operation: "OBSERVATION",
        status: "VERIFIED",
        observations,
      }
    : {
        ...metadata,
        operation: "OBSERVATION",
        status: state.status,
      };

  deepFreezeOwned(result);
  return result;
}

export function normalizeObservations(
  input: ObservationInput,
): ObservationResult {
  const result = runObservations(input, null);
  if (result === null) throw new Error("Standalone control reservation invariant violated");
  return result;
}

/** @internal Mapping only; not part of the public Option A API.
 * Mapping has already counted the same owned input in its logical budget.
 * null means initial control reservation failed: no State/input processing.
 * After any reservation refusal Mapping must not continue validation,
 * even when an already-known CONTRADICTED takes priority in the result.
 */
export function normalizeObservationsWithSharedAux(
  input: ObservationInput,
  sharedAux: SharedAuxReservation,
): ObservationResult | null {
  return runObservations(input, sharedAux);
}

function runObservations(
  input: ObservationInput,
  sharedAux: SharedAuxReservation | null,
): ObservationResult | null {
  if (CONTROL_ACCOUNTED > CONTROL_RESERVE || CONTROL_RESERVE > AUX_LIMIT) {
    throw new Error("Fixed control reservation invariant violated");
  }

  // Reserve before State, its arrays/maps, and the output array exist.
  if (sharedAux !== null && !sharedAux.reserveAux(CONTROL_RESERVE)) return null;

  const state: State = {
    sharedAux,
    inputBytes: 0,
    auxiliaryBytes: CONTROL_RESERVE,
    status: null,
    reason: "",
    diagnostics: [],
    omittedDiagnostics: 0,
    stopped: false,
    inputComplete: false,
    normalizedCount: 0,

    // Absence placeholders: finish() exposes their acquisition state.
    // Never used as accepted versions or passed to matchProfile().
    versions: { abi: "", rules: "", budget: "" },
    versionsCopied: false,
    profileMatched: false,
    chainMagnitudeBytes: new Map<bigint, number>(),
    chainDecimal: new Map<bigint, string>(),

    inputRefs: [],
    provenance: [],
  };

  const observations: Observation[] = [];

  try {
    const owned = copyInput(state, input);

    const matched = matchProfile(owned.scope.versions, owned.budget);

    if (matched.status !== "MATCHED") {
      stop(state, matched.status, matched.reasonCode);
    }

    state.profileMatched = true;
    const limits = matched.profile.limits;

    // Bootstrap ceilings must match this sole registered profile.
    if (
      limits.maxLogicalInputBytes !== INPUT_LIMIT ||
      limits.maxAuxiliaryBufferBytes !== AUX_LIMIT ||
      limits.maxSourceRecords !== SOURCE_LIMIT ||
      limits.maxLogTopics !== TOPIC_LIMIT ||
      limits.maxDiagnostics !== DIAGNOSTIC_LIMIT
    ) {
      throw new Error("Observation bootstrap/profile invariant violated");
    }

    checkReference(state, owned.scope.inputRef, "SCOPE");
    checkReference(state, owned.budget.inputRef, "BUDGET");

    reserveScaled(state, 16, owned.sources.length + 2, 8);
    state.inputRefs.push(owned.scope.inputRef, owned.budget.inputRef);

    reserveAux(state, 16);
    const provenanceById = new Map<string, Provenance>();

    for (const record of owned.provenance) {
      if (
        record.id.length === 0 ||
        record.method.length === 0 ||
        record.provider.length === 0 ||
        record.acquisitionScope.length === 0 ||
        (
          record.capture !== "FULL" &&
          record.capture !== "PARTIAL" &&
          record.capture !== "UNKNOWN"
        )
      ) {
        addIssue(state, "CONTRADICTED", "PROVENANCE_RECORD_INVALID");
      }

      const prior = provenanceById.get(record.id);

      if (prior !== undefined) {
        if (!sameProvenance(prior, record)) {
          addIssue(state, "CONTRADICTED", "PROVENANCE_ID_CONFLICT");
        }
      } else {
        // Logical Map entry: key/value bookkeeping plus a list slot.
        reserveAux(state, 80);
        provenanceById.set(record.id, record);
        state.provenance.push(record);
      }
    }

    checkProvenanceRefs(state, owned.scope.provenance, provenanceById);
    checkProvenanceRefs(state, owned.budget.provenance, provenanceById);

    if (owned.scope.expectedChainId <= 0n) {
      addIssue(state, "CONTRADICTED", "EXPECTED_CHAIN_ID_INVALID");
    }

    const normalEmitter = normalizeHex(
      state,
      owned.scope.normalEmitter,
      20,
    ) as Address | null;

    const erc1271Emitter = owned.scope.erc1271Emitter === null
      ? null
      : normalizeHex(state, owned.scope.erc1271Emitter, 20) as Address | null;

    reserveAux(state, 32);
    const buckets = new Map<string, Bucket>();
    const sourcesByInputId = new Map<string, SourceRecord>();

    for (const raw of owned.sources) {
      checkReference(state, raw.inputRef, "SOURCE");
      checkProvenanceRefs(state, raw.provenance, provenanceById);
      state.inputRefs.push(raw.inputRef);

      const source = normalizeSource(state, raw);
      state.normalizedCount += 1;

      const sameInputId = sourcesByInputId.get(source.inputRef.id);

      if (sameInputId !== undefined) {
        if (!sameSourceContent(sameInputId, source)) {
          addIssue(state, "CONTRADICTED", "SOURCE_INPUT_ID_CONFLICT");
        }
      } else {
        reserveAux(state, 72);
        sourcesByInputId.set(source.inputRef.id, source);
      }

      if (
        source.chainId !== null &&
        source.chainId !== owned.scope.expectedChainId
      ) {
        addIssue(state, "CONTRADICTED", "SOURCE_CHAIN_SCOPE_CONFLICT");
      }

      if (
        source.emitter !== null &&
        normalEmitter !== null &&
        source.emitter !== normalEmitter &&
        source.emitter !== erc1271Emitter
      ) {
        addIssue(state, "UNSUPPORTED", "SOURCE_EMITTER_OUTSIDE_SCOPE");
      }

      if (
        source.chainId === null ||
        source.blockHash === null ||
        source.sourceLogIndex === null
      ) {
        continue;
      }

      reserveAux(state, 64);
      const identity: SourceIdentity = {
        chainId: source.chainId,
        blockHash: source.blockHash,
        sourceLogIndex: source.sourceLogIndex,
      };

      const key = identityKey(state, identity);
      const bucket = buckets.get(key);

      if (bucket === undefined) {
        reserveAux(state, 72 + 32 + 24);
        buckets.set(key, { records: [source] });
      } else {
        // Compare all previous records: a missing value in the first
        // record must not hide a conflict between later known values.
        for (const prior of bucket.records) {
          if (knownConflict(prior, source)) {
            addIssue(state, "CONTRADICTED", "SOURCE_IDENTITY_CONFLICT");
          }
        }

        reserveAux(state, 8);
        bucket.records.push(source);
      }
    }

    if (state.status === null) {
      reserveScaled(state, 16, buckets.size, 8);

      for (const bucket of buckets.values()) {
        const first = bucket.records[0];

        if (first === undefined || !complete(first)) {
          throw new Error("Verified Observation completeness invariant violated");
        }

        reserveScaled(state, 16, bucket.records.length, 8);
        const inputRefs: InputReference[] = [];

        reserveAux(state, 16);
        const provenance: ProvenanceRef[] = [];

        for (const record of bucket.records) {
          inputRefs.push(record.inputRef);

          for (const ref of record.provenance) {
            // Keep every supplied acquisition reference occurrence.
            reserveAux(state, 8);
            provenance.push(ref);
          }
        }

        reserveAux(state, 64 + 16 + 9 * 16);

        observations.push({
          identity: {
            chainId: first.chainId!,
            blockHash: first.blockHash! as Hash32,
            sourceLogIndex: first.sourceLogIndex!,
          },
          transactionHash: first.transactionHash! as Hash32,
          blockNumber: first.blockNumber!,
          transactionIndex: first.transactionIndex!,
          emitter: first.emitter! as Address,
          topics: first.topics!,
          data: first.data!,
          inputRefs,
          provenance,
        });
      }
    }
  } catch (error: unknown) {
    if (error !== STOP) {
      // Internal defects, unexpected exceptions and OOM are not
      // converted into evidence classifications.
      throw error;
    }
  }

  return finish(state, observations);
}
