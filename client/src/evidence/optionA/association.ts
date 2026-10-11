import type {
  Budget,
  CaptureState,
  Hash32,
  HexBytes,
} from "./types";

type NormalSignatureLimits = Pick<
  Budget,
  | "maxCalldataBytes"
  | "maxNormalSafeActions"
  | "maxNormalSafeGroups"
>;

type ReserveAux = (bytes: number) => boolean;

interface NormalSignatureGroup {
  readonly groupOrdinal: number;
  readonly groupSize: number;
  readonly firstActionOrdinal: number;
  readonly actionEndOrdinalExclusive: number;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly v: number;
  readonly r: Hash32;
  readonly s: Hash32;
}

interface ParsedNormalSignatureGroups {
  readonly status: "PARSED";
  readonly groups: readonly NormalSignatureGroup[];
  readonly actionCount: number;
  readonly consumedBytes: number;
  readonly trailingOffset: number;
  readonly trailingByteCount: number;
}

type SignatureFailure = {
  readonly status:
    | "CONTRADICTED"
    | "INSUFFICIENT"
    | "UNSUPPORTED"
    | "RESOURCE_LIMIT";
  readonly reasonCode: string;
};

type NormalSignatureParseResult =
  | ParsedNormalSignatureGroups
  | SignatureFailure;

/*
 * Fixed immutable failures:
 * no caller-owned references, no allocation on a stopping path.
 *
 * Module/static storage must be included in the enclosing
 * implementation's control accounting.
 */
const INVALID_ACTION_COUNT = Object.freeze({
  status: "CONTRADICTED",
  reasonCode: "NORMAL_ACTION_COUNT_INVALID",
} as const);

const INVALID_CAPTURE = Object.freeze({
  status: "CONTRADICTED",
  reasonCode: "SIGNATURE_CAPTURE_INVALID",
} as const);

const INCOMPLETE_CAPTURE = Object.freeze({
  status: "INSUFFICIENT",
  reasonCode: "SIGNATURE_CAPTURE_NOT_FULL",
} as const);

const INVALID_HEX = Object.freeze({
  status: "CONTRADICTED",
  reasonCode: "SIGNATURE_HEX_INVALID",
} as const);

const INPUT_LIMIT = Object.freeze({
  status: "RESOURCE_LIMIT",
  reasonCode: "SIGNATURE_BYTES_LIMIT",
} as const);

const AUX_LIMIT = Object.freeze({
  status: "RESOURCE_LIMIT",
  reasonCode: "SIGNATURE_AUXILIARY_LIMIT",
} as const);

const INVALID_GROUP_COUNT = Object.freeze({
  status: "CONTRADICTED",
  reasonCode: "NORMAL_SIGNATURE_GROUP_COUNT_INVALID",
} as const);

const INVALID_GROUP_SIZE = Object.freeze({
  status: "CONTRADICTED",
  reasonCode: "NORMAL_SIGNATURE_GROUP_SIZE_INVALID",
} as const);

const COVERAGE_MISMATCH = Object.freeze({
  status: "CONTRADICTED",
  reasonCode: "NORMAL_SIGNATURE_ACTION_COVERAGE_MISMATCH",
} as const);

/*
 * PROPOSED for NORMAL pending direct Solidity confirmation:
 * do not emulate assembly reads outside the supplied bytes.
 */
const SHORT_SIGNATURE = Object.freeze({
  status: "UNSUPPORTED",
  reasonCode: "NORMAL_SHORT_SIGNATURE_READ_UNSUPPORTED",
} as const);

function hexNibble(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return -1;
}

/*
 * Called only after complete hex validation and offset checks.
 * Does not construct a decoded byte buffer.
 */
function readByte(hex: string, offset: number): number {
  const position = 2 + offset * 2;
  return (
    hexNibble(hex.charCodeAt(position)) * 16 +
    hexNibble(hex.charCodeAt(position + 1))
  );
}

function readU16BE(hex: string, offset: number): number {
  return readByte(hex, offset) * 256 + readByte(hex, offset + 1);
}

function hasBytes(
  byteLength: number,
  offset: number,
  count: number,
): boolean {
  return (
    Number.isSafeInteger(offset) &&
    Number.isSafeInteger(count) &&
    offset >= 0 &&
    count >= 0 &&
    offset <= byteLength &&
    count <= byteLength - offset
  );
}

/**
 * @internal
 *
 * This helper consumes only NORMAL signature group bytes.
 * It performs neither cryptographic verification nor Mapping.
 *
 * registeredLimits must come from the matched fixed profile.
 * reserveAux must reserve from the enclosing call's shared budget.
 */
export function parseNormalSignatureGroups(
  sigs: HexBytes,
  actionCount: number,
  capture: CaptureState,
  registeredLimits: NormalSignatureLimits,
  reserveAux: ReserveAux,
): NormalSignatureParseResult {
  const actionLimit = registeredLimits.maxNormalSafeActions;
  const groupLimit = registeredLimits.maxNormalSafeGroups;
  const byteLimit = registeredLimits.maxCalldataBytes;

  /*
   * A bad registered configuration is an implementation defect.
   * Do not disguise it as evidence classification.
   */
  if (
    actionLimit !== 256 ||
    groupLimit !== 256 ||
    byteLimit !== 1_048_576
  ) {
    throw new Error("Unexpected registered NORMAL limits");
  }

  if (
    !Number.isSafeInteger(actionCount) ||
    actionCount < 1 ||
    actionCount > actionLimit
  ) {
    return INVALID_ACTION_COUNT;
  }

  if (
    capture !== "FULL" &&
    capture !== "PARTIAL" &&
    capture !== "UNKNOWN"
  ) {
    return INVALID_CAPTURE;
  }

  /*
   * Do not interpret partial bytes as complete calldata.
   * No signature bytes are scanned on this branch.
   */
  if (capture !== "FULL") {
    return INCOMPLETE_CAPTURE;
  }

  if (typeof sigs !== "string") {
    return INVALID_HEX;
  }

  /*
   * Inspect length before a complete character scan.
   * Signature bytes are a subregion of bounded calldata.
   */
  if (sigs.length > 2 + byteLimit * 2) {
    return INPUT_LIMIT;
  }

  if (
    sigs.length < 2 ||
    sigs.charCodeAt(0) !== 48 ||
    sigs.charCodeAt(1) !== 120 ||
    (sigs.length - 2) % 2 !== 0
  ) {
    return INVALID_HEX;
  }

  for (let i = 2; i < sigs.length; i += 1) {
    if (hexNibble(sigs.charCodeAt(i)) < 0) {
      return INVALID_HEX;
    }
  }

  const byteLength = (sigs.length - 2) / 2;

  if (!hasBytes(byteLength, 0, 2)) {
    return SHORT_SIGNATURE;
  }

  const numGroups = readU16BE(sigs, 0);

  if (
    numGroups < 1 ||
    numGroups > groupLimit ||
    numGroups > actionCount
  ) {
    return INVALID_GROUP_COUNT;
  }

  /*
   * numGroups <= 256, so this multiplication is bounded.
   * Still check the resulting offset explicitly.
   */
  const consumedBytes = 2 + numGroups * 67;

  if (
    !Number.isSafeInteger(consumedBytes) ||
    !hasBytes(byteLength, 0, consumedBytes)
  ) {
    return SHORT_SIGNATURE;
  }

  /*
   * First pass: validate coverage without output allocation.
   * The action range is [0, actionCount), partitioned in group order.
   */
  let coveredActions = 0;

  for (let groupOrdinal = 0; groupOrdinal < numGroups; groupOrdinal += 1) {
    const startOffset = 2 + groupOrdinal * 67;

    if (!hasBytes(byteLength, startOffset, 67)) {
      return SHORT_SIGNATURE;
    }

    const groupSize = readU16BE(sigs, startOffset);

    if (groupSize === 0) {
      return INVALID_GROUP_SIZE;
    }

    if (groupSize > actionCount - coveredActions) {
      return COVERAGE_MISMATCH;
    }

    coveredActions += groupSize;
  }

  if (coveredActions !== actionCount) {
    return COVERAGE_MISMATCH;
  }

  /*
   * PROPOSED logical capacity reservation:
   *
   * Per group:
   * - object: 16 + 16 * 9 = 160
   * - conservative scalar/reference allowance: 9 * 8 = 72
   * - r/s normalized strings: 2 * (8 + 2 * 66) = 280
   * Total: 512
   *
   * During construction reserve temporary slice/lowercase/prefix
   * string capacity conservatively once: 512.
   *
   * Array: 16 + 8 * numGroups.
   * Result object and conservative slots: 256.
   *
   * This is the logical model, not a JS heap/RSS upper bound.
   */
  const auxiliaryBytes =
    16 + numGroups * (8 + 512) + 512 + 256;

  if (!Number.isSafeInteger(auxiliaryBytes)) {
    throw new Error("NORMAL signature reservation invariant failed");
  }

  if (!reserveAux(auxiliaryBytes)) {
    return AUX_LIMIT;
  }

  const groups: NormalSignatureGroup[] = [];
  let firstActionOrdinal = 0;

  for (let groupOrdinal = 0; groupOrdinal < numGroups; groupOrdinal += 1) {
    const startOffset = 2 + groupOrdinal * 67;
    const groupSize = readU16BE(sigs, startOffset);

    const rStart = 2 + (startOffset + 3) * 2;
    const sStart = 2 + (startOffset + 35) * 2;

    const r = (
      "0x" + sigs.slice(rStart, rStart + 64).toLowerCase()
    ) as Hash32;

    const s = (
      "0x" + sigs.slice(sStart, sStart + 64).toLowerCase()
    ) as Hash32;

    groups.push(Object.freeze({
      groupOrdinal,
      groupSize,
      firstActionOrdinal,
      actionEndOrdinalExclusive: firstActionOrdinal + groupSize,
      startOffset,
      endOffset: startOffset + 67,
      v: readByte(sigs, startOffset + 2),
      r,
      s,
    }));

    firstActionOrdinal += groupSize;
  }

  Object.freeze(groups);

  return Object.freeze({
    status: "PARSED",
    groups,
    actionCount,
    consumedBytes,
    trailingOffset: consumedBytes,
    trailingByteCount: byteLength - consumedBytes,
  });
}

/*
 * Internal NORMAL action/signature association.
 *
 * Preconditions:
 * - packed is an owned, bounded, ordinary Uint8Array.
 * - sigs/capture have passed the enclosing input-shape boundary.
 * - limits comes from matchProfile().profile.limits.
 * - reserveAux is shared with the enclosing operation and is monotonic.
 * - parseActions is the unchanged R23 parseStrictActionBatch.
 *
 * No Mapping VERIFIED result is produced.
 */

type AssociationLimits = NormalSignatureLimits &
  Pick<Budget, "maxPackedActionBytes">;

/*
 * Structural view of the existing helper result.
 * No ParsedAction public type is introduced.
 */
type ActionParser = (packed: Uint8Array) => {
  actionCount: number;
  actions: {
    ordinal: number;
    startOffset: number;
    endOffset: number;
    bytes: Uint8Array;
    actionType: number;
    senderId: number;
    receiverId: number;
    receiverCawonce: number;
    networkId: number;
    cawonce: number;
  }[];
};

interface AssociatedActionMetadata {
  readonly actionOrdinal: number;
  readonly groupActionOrdinal: number;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly senderId: number;
  readonly cawonce: number;
  readonly networkId: number;
}

interface AssociatedGroupMetadata {
  readonly groupOrdinal: number;
  readonly groupSize: number;
  readonly signatureKind: "SINGLE" | "BATCH";
  readonly firstActionOrdinal: number;
  readonly actionEndOrdinalExclusive: number;
  readonly actionStartOffset: number;
  readonly actionEndOffset: number;
  readonly signatureStartOffset: number;
  readonly signatureEndOffset: number;
  readonly v: number;
  readonly r: Hash32;
  readonly s: Hash32;
  readonly actions: readonly AssociatedActionMetadata[];
}

interface NormalAssociation {
  readonly status: "ASSOCIATED";
  readonly actionCount: number;
  readonly networkId: number;
  readonly packedConsumedBytes: number;
  readonly signatureConsumedBytes: number;
  readonly signatureTrailingOffset: number;
  readonly signatureTrailingByteCount: number;
  readonly groups: readonly AssociatedGroupMetadata[];
}

type AssociationFailure = SignatureFailure;

type NormalAssociationResult =
  | NormalAssociation
  | AssociationFailure;

const ASSOCIATION_INPUT_LIMIT = Object.freeze({
  status: "RESOURCE_LIMIT",
  reasonCode: "NORMAL_PACKED_ACTION_BYTES_LIMIT",
} as const);

const ASSOCIATION_AUX_LIMIT = Object.freeze({
  status: "RESOURCE_LIMIT",
  reasonCode: "NORMAL_ASSOCIATION_AUXILIARY_LIMIT",
} as const);

const ASSOCIATION_SENDER_CONFLICT = Object.freeze({
  status: "CONTRADICTED",
  reasonCode: "NORMAL_GROUP_SENDER_MISMATCH",
} as const);

const ASSOCIATION_CAWONCE_CONFLICT = Object.freeze({
  status: "CONTRADICTED",
  reasonCode: "NORMAL_GROUP_CAWONCE_MISMATCH",
} as const);

const ASSOCIATION_NETWORK_CONFLICT = Object.freeze({
  status: "CONTRADICTED",
  reasonCode: "NORMAL_CALL_NETWORK_MISMATCH",
} as const);

const ASSOCIATION_CAPTURE_INVALID = Object.freeze({
  status: "CONTRADICTED",
  reasonCode: "NORMAL_ASSOCIATION_CAPTURE_INVALID",
} as const);

const ASSOCIATION_CAPTURE_MISSING = Object.freeze({
  status: "INSUFFICIENT",
  reasonCode: "NORMAL_ASSOCIATION_CAPTURE_NOT_FULL",
} as const);

function requireAssociationInvariant(
  condition: boolean,
): asserts condition {
  if (!condition) {
    /*
     * Parser output inconsistency is an implementation/dependency defect.
     * It is not automatically evidence contradiction.
     */
    throw new Error("NORMAL association dependency invariant failed");
  }
}

function isAssociationU32(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 0xffff_ffff
  );
}

/*
 * Internal function: intentionally not exported.
 *
 * The capture argument describes the complete bound call input,
 * including packedActions and sigs.
 */
function associateNormalActions(
  packed: Uint8Array,
  sigs: HexBytes,
  capture: CaptureState,
  limits: AssociationLimits,
  reserveAux: ReserveAux,
  parseActions: ActionParser,
): NormalAssociationResult {
  requireAssociationInvariant(
    limits.maxPackedActionBytes === 1_048_576 &&
    limits.maxCalldataBytes === 1_048_576 &&
    limits.maxNormalSafeActions === 256 &&
    limits.maxNormalSafeGroups === 256,
  );

  if (
    capture !== "FULL" &&
    capture !== "PARTIAL" &&
    capture !== "UNKNOWN"
  ) {
    return ASSOCIATION_CAPTURE_INVALID;
  }

  if (capture !== "FULL") {
    return ASSOCIATION_CAPTURE_MISSING;
  }

  const packedLength = packed.length;

  if (packedLength > limits.maxPackedActionBytes) {
    return ASSOCIATION_INPUT_LIMIT;
  }

  /*
   * Reserve before invoking the unchanged action parser.
   *
   * Successful parser allocations:
   * - all action byte copies together: <= packedLength
   * - per action object/scalars/buffer header/array slot: <= 288
   * - batch result and outer array: <= 128
   *
   * Conservative helper string allowance:
   * - <= 32 construction occurrences per action
   * - each <= 128 UTF-16 code units
   * - logical string cost: 8 + 2 * length
   *
   * The allowance is cumulative; reclamation is not assumed.
   * Fixed helper/function/module control belongs to enclosing control
   * accounting. This is not a JS heap/RSS bound.
   *
   * Reserve for 256 actions before reading/parsing action fields.
   */
  const actionParserReservation =
    packedLength +
    256 * (288 + 32 * (8 + 2 * 128)) +
    128;

  requireAssociationInvariant(
    Number.isSafeInteger(actionParserReservation),
  );

  if (!reserveAux(actionParserReservation)) {
    return ASSOCIATION_AUX_LIMIT;
  }

  /*
   * Intentionally no catch:
   * do not translate ordinary Error/OOM/internal defects into statuses.
   */
  const batch = parseActions(packed);
  const actionCount = batch.actionCount;

  requireAssociationInvariant(
    Number.isSafeInteger(actionCount) &&
    actionCount >= 1 &&
    actionCount <= 256 &&
    batch.actions.length === actionCount,
  );

  let nextActionOffset = 2;

  for (let i = 0; i < actionCount; i += 1) {
    const action = batch.actions[i];

    requireAssociationInvariant(
      action.ordinal === i &&
      Number.isSafeInteger(action.startOffset) &&
      Number.isSafeInteger(action.endOffset) &&
      action.startOffset === nextActionOffset &&
      action.endOffset > action.startOffset &&
      action.endOffset <= packedLength &&
      action.bytes.length ===
        action.endOffset - action.startOffset &&
      isAssociationU32(action.senderId) &&
      isAssociationU32(action.cawonce) &&
      isAssociationU32(action.networkId),
    );

    nextActionOffset = action.endOffset;
  }

  requireAssociationInvariant(nextActionOffset === packedLength);

  const signatures = parseNormalSignatureGroups(
    sigs,
    actionCount,
    capture,
    limits,
    reserveAux,
  );

  if (signatures.status !== "PARSED") {
    return signatures;
  }

  const groupCount = signatures.groups.length;

  requireAssociationInvariant(
    signatures.actionCount === actionCount &&
    groupCount >= 1 &&
    groupCount <= actionCount,
  );

  const callNetworkId = batch.actions[0].networkId;
  let nextActionOrdinal = 0;

  /*
   * Validate every association before allocating its output.
   */
  for (let g = 0; g < groupCount; g += 1) {
    const group = signatures.groups[g];
    const first = group.firstActionOrdinal;
    const end = group.actionEndOrdinalExclusive;

    requireAssociationInvariant(
      group.groupOrdinal === g &&
      Number.isSafeInteger(group.groupSize) &&
      group.groupSize > 0 &&
      first === nextActionOrdinal &&
      end === first + group.groupSize &&
      end <= actionCount &&
      group.startOffset === 2 + 67 * g &&
      group.endOffset === group.startOffset + 67,
    );

    const firstAction = batch.actions[first];

    for (let ordinal = first; ordinal < end; ordinal += 1) {
      const action = batch.actions[ordinal];
      const groupOrdinal = ordinal - first;

      if (action.networkId !== callNetworkId) {
        return ASSOCIATION_NETWORK_CONFLICT;
      }

      if (group.groupSize > 1) {
        if (action.senderId !== firstAction.senderId) {
          return ASSOCIATION_SENDER_CONFLICT;
        }

        /*
         * Both operands are bounded; JS addition is exact here.
         * Explicitly reject uint32 overflow, with no wraparound.
         */
        const expectedCawonce =
          firstAction.cawonce + groupOrdinal;

        if (
          expectedCawonce > 0xffff_ffff ||
          action.cawonce !== expectedCawonce
        ) {
          return ASSOCIATION_CAWONCE_CONFLICT;
        }
      }
    }

    nextActionOrdinal = end;
  }

  requireAssociationInvariant(
    nextActionOrdinal === actionCount &&
    signatures.consumedBytes === 2 + 67 * groupCount &&
    signatures.trailingOffset === signatures.consumedBytes,
  );

  /*
   * New output metadata only; no Uint8Array is exposed.
   *
   * Per action:
   *   object 16 + 16*7, scalar allowance 8*7,
   *   containing array slot 8 => 192.
   *
   * Per group:
   *   object 16 + 16*13, slot allowance 8*13,
   *   action-array header 16, outer slot 8 => 352.
   *
   * Root + outer array: <= 256.
   *
   * r/s and signatureKind are immutable strings. r/s storage was
   * already reserved by the signature parser.
   */
  const outputReservation =
    actionCount * 192 + groupCount * 352 + 256;

  requireAssociationInvariant(
    Number.isSafeInteger(outputReservation),
  );

  if (!reserveAux(outputReservation)) {
    return ASSOCIATION_AUX_LIMIT;
  }

  const groups: AssociatedGroupMetadata[] = [];

  for (let g = 0; g < groupCount; g += 1) {
    const signature = signatures.groups[g];
    const first = signature.firstActionOrdinal;
    const end = signature.actionEndOrdinalExclusive;
    const actions: AssociatedActionMetadata[] = [];

    for (let ordinal = first; ordinal < end; ordinal += 1) {
      const action = batch.actions[ordinal];

      actions.push(Object.freeze({
        actionOrdinal: ordinal,
        groupActionOrdinal: ordinal - first,
        startOffset: action.startOffset,
        endOffset: action.endOffset,
        senderId: action.senderId,
        cawonce: action.cawonce,
        networkId: action.networkId,
      }));
    }

    Object.freeze(actions);

    groups.push(Object.freeze({
      groupOrdinal: g,
      groupSize: signature.groupSize,
      signatureKind:
        signature.groupSize === 1 ? "SINGLE" : "BATCH",
      firstActionOrdinal: first,
      actionEndOrdinalExclusive: end,
      actionStartOffset: batch.actions[first].startOffset,
      actionEndOffset: batch.actions[end - 1].endOffset,
      signatureStartOffset: signature.startOffset,
      signatureEndOffset: signature.endOffset,
      v: signature.v,
      r: signature.r,
      s: signature.s,
      actions,
    }));
  }

  Object.freeze(groups);

  return Object.freeze({
    status: "ASSOCIATED",
    actionCount,
    networkId: callNetworkId,
    packedConsumedBytes: packedLength,
    signatureConsumedBytes: signatures.consumedBytes,
    signatureTrailingOffset: signatures.trailingOffset,
    signatureTrailingByteCount: signatures.trailingByteCount,
    groups,
  });
}

export { associateNormalActions };
