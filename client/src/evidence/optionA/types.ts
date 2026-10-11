/**
 * Canonical Action Evidence — Option A.
 *
 * Source draft for static review only.
 *
 * FROZEN:
 * - Semantics are grounded in the Phase I-07 contract.
 * - Verification is limited to provided evidence.
 * - Observation and Mapping have different VERIFIED payloads.
 *
 * PROPOSED:
 * - Type names, field layout, reference representation and capture
 *   representation are TypeScript proposals.
 *
 * Runtime validation, immutable construction and recursive freezing
 * are required separately. readonly does not provide those guarantees.
 */

export type EvidenceStatus =
  | "VERIFIED"
  | "AMBIGUOUS"
  | "INSUFFICIENT"
  | "CONTRADICTED"
  | "UNSUPPORTED"
  | "RESOURCE_LIMIT";

export type NonVerifiedStatus = Exclude<
  EvidenceStatus,
  "VERIFIED"
>;

export type VerificationScope = "PROVIDED_EVIDENCE_ONLY";

export type AssessmentState = "NOT_ASSESSED";

export type ProfileKind = "NORMAL" | "SAFE" | "ERC1271";

export type CoverageState = "FULL" | "PARTIAL" | "UNKNOWN";

/**
 * PROPOSED:
 * Reusing the coverage vocabulary for capture state requires review.
 * Capture and Coverage remain separate fields and concepts.
 */
export type CaptureState = "FULL" | "PARTIAL" | "UNKNOWN";

/**
 * Runtime requirements:
 * - ChainId is a positive bigint.
 * - NetworkId is a uint32.
 * - Ordinal is a nonnegative integer.
 */
export type ChainId = bigint;

export type NetworkId = number;

export type Ordinal = number;

/**
 * The template literal expresses only the prefix.
 * Byte validity, length and lowercase normalization require validation.
 */
export type HexBytes = `0x${string}`;

export type Hash32 = HexBytes;

export type Address = HexBytes;

/**
 * No frozen reason-code enumeration is claimed.
 */
export type ReasonCode = string;

/**
 * PROPOSED representation:
 * Provider-supplied time or null. No internal clock supplies this value.
 * The accepted string format remains OPEN.
 */
export type CaptureTime = string | null;

/**
 * PROPOSED structural representation.
 * Runtime validation must enforce the supported direct-call path.
 */
export type CallPath = readonly Ordinal[];

export interface ProfileVersions {
  readonly abi: string;
  readonly rules: string;
  readonly budget: string;
}

export interface SourceIdentity {
  readonly chainId: ChainId;
  readonly blockHash: Hash32;
  readonly sourceLogIndex: Ordinal;
}

export interface ReceiptIdentity {
  readonly chainId: ChainId;
  readonly blockHash: Hash32;
  readonly transactionIndex: Ordinal;
}

export interface GroupIdentity {
  readonly receipt: ReceiptIdentity;
  readonly callPath: CallPath;
  readonly groupOrdinal: Ordinal;
}

export interface ActionIdentity {
  readonly receipt: ReceiptIdentity;
  readonly callPath: CallPath;
  readonly actionOrdinal: Ordinal;
}

/**
 * PROPOSED reference representation.
 * IDs are supplied or assigned by the pure input-normalization boundary.
 * They do not imply an external registry or lookup.
 */
export interface ProvenanceRef {
  readonly id: string;
}

/**
 * Field names and string representations are PROPOSED.
 *
 * provider identifies the acquisition source.
 * acquisitionScope describes the acquisition target or scope.
 * Neither may contain credentials.
 *
 * capture describes acquisition state, not chain completeness.
 */
export interface Provenance {
  readonly id: string;
  readonly method: string;
  readonly provider: string;
  readonly acquisitionScope: string;
  readonly capture: CaptureState;
  readonly captureTime: CaptureTime;
  readonly description: string | null;
}

export interface ScopeInputReference {
  readonly kind: "SCOPE";
  readonly id: string;
}

export interface SourceInputReference {
  readonly kind: "SOURCE";
  readonly id: string;
}

export interface TransactionInputReference {
  readonly kind: "TRANSACTION";
  readonly id: string;
}

export interface ReceiptInputReference {
  readonly kind: "RECEIPT";
  readonly id: string;
}

export interface CoverageInputReference {
  readonly kind: "COVERAGE";
  readonly id: string;
}

export interface BudgetInputReference {
  readonly kind: "BUDGET";
  readonly id: string;
}

export type InputReference =
  | ScopeInputReference
  | SourceInputReference
  | TransactionInputReference
  | ReceiptInputReference
  | CoverageInputReference
  | BudgetInputReference;

/**
 * FULL is a provider declaration about supplied evidence.
 * It does not prove completeness on the chain.
 */
export interface Coverage {
  readonly inputRef: CoverageInputReference;
  readonly state: CoverageState;
  readonly provenance: readonly ProvenanceRef[];
}

/**
 * normalEmitter is used by the NORMAL and SAFE profiles.
 * null explicitly means that the ERC1271 emitter is not configured.
 *
 * Runtime validation still enforces the selected profile's
 * single-emitter scope.
 */
export interface Scope {
  readonly inputRef: ScopeInputReference;
  readonly expectedChainId: ChainId;
  readonly normalEmitter: Address;
  readonly erc1271Emitter: Address | null;
  readonly versions: ProfileVersions;
  readonly provenance: readonly ProvenanceRef[];
}

/**
 * Field names are PROPOSED.
 *
 * Runtime validation must enforce the frozen versioned limits.
 * This interface does not authorize larger limits or infinite values.
 */
export interface Budget {
  readonly inputRef: BudgetInputReference;
  readonly version: string;

  readonly maxCalldataBytes: number;
  readonly maxPackedActionBytes: number;
  readonly maxLogicalInputBytes: number;

  readonly maxReceiptLogs: number;
  readonly maxSourceRecords: number;
  readonly maxLogTopics: number;

  readonly maxNormalSafeActions: number;
  readonly maxNormalSafeGroups: number;

  readonly maxERC1271Groups: number;
  readonly maxERC1271Actions: number;
  readonly maxERC1271GroupSize: number;

  readonly maxSafeDPStates: number;
  readonly maxSafeDPWorkUnits: number;
  readonly maxReasonByteComparisons: number;

  readonly maxAuxiliaryBufferBytes: number;
  readonly maxDiagnostics: number;

  readonly provenance: readonly ProvenanceRef[];
}

/**
 * Every field is present in this proposed input shape.
 * null means that the context was not supplied.
 *
 * Missing context must not be reconstructed by guessing.
 * Validation determines the appropriate non-VERIFIED result.
 */
export interface SourceRecord {
  readonly inputRef: SourceInputReference;

  readonly chainId: ChainId | null;
  readonly blockHash: Hash32 | null;
  readonly blockNumber: bigint | null;

  readonly transactionHash: Hash32 | null;
  readonly transactionIndex: Ordinal | null;
  readonly sourceLogIndex: Ordinal | null;

  readonly emitter: Address | null;
  readonly topics: readonly HexBytes[] | null;
  readonly data: HexBytes | null;

  readonly provenance: readonly ProvenanceRef[];
}

export interface TransactionEvidence {
  readonly inputRef: TransactionInputReference;

  readonly hash: Hash32 | null;
  readonly chainId: ChainId | null;
  readonly blockHash: Hash32 | null;
  readonly blockNumber: bigint | null;
  readonly transactionIndex: Ordinal | null;

  readonly to: Address | null;
  readonly data: HexBytes | null;

  readonly capture: CaptureState;
  readonly provenance: readonly ProvenanceRef[];
}

/**
 * Context values are supplied for this individual log.
 * Parent receipt context must not silently replace missing values
 * or overwrite a conflicting supplied value.
 *
 * null represents unacquired context. It is not proof of consistency.
 */
export interface ReceiptLogEvidence {
  readonly logIndex: Ordinal | null;

  readonly transactionHash: Hash32 | null;
  readonly chainId: ChainId | null;
  readonly blockHash: Hash32 | null;
  readonly blockNumber: bigint | null;
  readonly transactionIndex: Ordinal | null;

  readonly emitter: Address | null;
  readonly topics: readonly HexBytes[] | null;
  readonly data: HexBytes | null;
}

export interface ReceiptEvidence {
  readonly inputRef: ReceiptInputReference;

  readonly transactionHash: Hash32 | null;
  readonly chainId: ChainId | null;
  readonly blockHash: Hash32 | null;
  readonly blockNumber: bigint | null;
  readonly transactionIndex: Ordinal | null;

  readonly status: 0 | 1 | null;
  readonly logs: readonly ReceiptLogEvidence[] | null;

  readonly capture: CaptureState;
  readonly provenance: readonly ProvenanceRef[];
}

export interface ObservationInput {
  readonly scope: Scope;
  readonly budget: Budget;
  readonly sources: readonly SourceRecord[];
  readonly provenance: readonly Provenance[];
}

/**
 * Packed action bytes are derived from the bound transaction calldata.
 * This input has no independently supplied packed-bytes substitute.
 */
export interface MappingInput {
  readonly scope: Scope;
  readonly budget: Budget;

  readonly transaction: TransactionEvidence;
  readonly receipt: ReceiptEvidence;
  readonly sources: readonly SourceRecord[];

  readonly receiptLogCoverage: Coverage;
  readonly sourceCoverage: Coverage;

  readonly provenance: readonly Provenance[];
}

/**
 * VERIFIED Observation means normalization and same-identity
 * consistency only.
 *
 * It does not establish Mapping, receipt success, canonicality
 * or finality.
 *
 * Required transaction and block context was confirmed in PRB-R07.
 * Missing input context does not produce a VERIFIED Observation.
 */
export interface Observation {
  readonly identity: SourceIdentity;

  readonly transactionHash: Hash32;
  readonly blockNumber: bigint;
  readonly transactionIndex: Ordinal;

  readonly emitter: Address;
  readonly topics: readonly HexBytes[];
  readonly data: HexBytes;

  readonly inputRefs: readonly InputReference[];
  readonly provenance: readonly ProvenanceRef[];
}

export interface SourceReference {
  readonly identity: SourceIdentity;
  readonly inputRefs: readonly InputReference[];
  readonly provenance: readonly ProvenanceRef[];
}

/**
 * actionOrdinal is the original receipt/call-path action ordinal.
 * Rejected actions do not cause renumbering.
 *
 * groupActionOrdinal preserves the position within the group.
 */
export interface ActionLocation {
  readonly identity: ActionIdentity;
  readonly group: GroupIdentity;
  readonly groupActionOrdinal: Ordinal;
}

export interface SuccessfulActionMapping extends ActionLocation {
  readonly outcome: "SUCCESS";
  readonly source: SourceReference;
}

export interface RejectedActionMapping extends ActionLocation {
  readonly outcome: "REJECTED";
  readonly source: SourceReference;
  readonly reason: HexBytes;
}

export type ActionMapping =
  | SuccessfulActionMapping
  | RejectedActionMapping;

export interface SuccessfulGroupMapping {
  readonly identity: GroupIdentity;
  readonly outcome: "SUCCESS";
  readonly actions: NonEmptyReadonlyArray<SuccessfulActionMapping>;
  readonly sources: readonly SourceReference[];
}

export interface RejectedGroupMapping {
  readonly identity: GroupIdentity;
  readonly outcome: "REJECTED";
  readonly actions: NonEmptyReadonlyArray<RejectedActionMapping>;
  readonly sources: readonly SourceReference[];
  readonly reason: HexBytes;
}

export type GroupMapping =
  | SuccessfulGroupMapping
  | RejectedGroupMapping;

export type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];

/**
 * PROPOSED commitment-result representation.
 *
 * Runtime validation must enforce profile-specific AP count,
 * ordering, binding, action count and full packed-byte commitment.
 */
export interface VerifiedAPCommitment {
  readonly event: SourceReference;
  readonly group: GroupIdentity | null;
  readonly actionCount: number;
  readonly batchHash: Hash32;
}

export interface VerifiedCommitmentResult {
  readonly status: "VERIFIED";
  readonly events: NonEmptyReadonlyArray<VerifiedAPCommitment>;
}

export interface SingleAPCommitmentResult
  extends VerifiedCommitmentResult {
  readonly events: readonly [VerifiedAPCommitment];
}

export interface NotApplicableCommitmentResult {
  readonly status: "NOT_APPLICABLE";
  readonly events: readonly [];
}

export interface MappingContext {
  readonly receiptIdentity: ReceiptIdentity;
  readonly callPath: CallPath;
  readonly sourceCorrespondence: readonly SourceReference[];
}

export interface NormalMappingPayload extends MappingContext {
  readonly profile: "NORMAL";
  readonly outcomeKind: "HAS_SUCCESS";

  readonly groups: NonEmptyReadonlyArray<SuccessfulGroupMapping>;
  readonly actions: NonEmptyReadonlyArray<SuccessfulActionMapping>;
  readonly successfulActions:
    NonEmptyReadonlyArray<SuccessfulActionMapping>;

  readonly successfulActionCount: number;
  readonly commitment: SingleAPCommitmentResult;
}

export interface ERC1271MappingPayload extends MappingContext {
  readonly profile: "ERC1271";
  readonly outcomeKind: "HAS_SUCCESS";

  readonly groups: NonEmptyReadonlyArray<SuccessfulGroupMapping>;
  readonly actions: NonEmptyReadonlyArray<SuccessfulActionMapping>;
  readonly successfulActions:
    NonEmptyReadonlyArray<SuccessfulActionMapping>;

  readonly successfulActionCount: number;
  readonly commitment: VerifiedCommitmentResult;
}

export interface SafeSuccessMappingPayload extends MappingContext {
  readonly profile: "SAFE";
  readonly outcomeKind: "HAS_SUCCESS";

  readonly groups: NonEmptyReadonlyArray<GroupMapping>;
  readonly actions: NonEmptyReadonlyArray<ActionMapping>;
  readonly successfulActions:
    NonEmptyReadonlyArray<SuccessfulActionMapping>;

  readonly successfulActionCount: number;
  readonly commitment: SingleAPCommitmentResult;
}

/**
 * ALL_REJECTED is a formal VERIFIED SAFE outcome.
 * It is not available to NORMAL or ERC1271.
 */
export interface SafeAllRejectedMappingPayload extends MappingContext {
  readonly profile: "SAFE";
  readonly outcomeKind: "ALL_REJECTED";

  readonly groups: NonEmptyReadonlyArray<RejectedGroupMapping>;
  readonly actions: NonEmptyReadonlyArray<RejectedActionMapping>;
  readonly successfulActions: readonly [];

  readonly successfulActionCount: 0;
  readonly commitment: NotApplicableCommitmentResult;
}

export type VerifiedMappingPayload =
  | NormalMappingPayload
  | ERC1271MappingPayload
  | SafeSuccessMappingPayload
  | SafeAllRejectedMappingPayload;

export interface Diagnostic {
  readonly reasonCode: ReasonCode;
  readonly message: string;
  readonly inputRefs: readonly InputReference[];
  readonly sourceRefs: readonly SourceReference[];
}

/**
 * PROPOSED assessment labels.
 * These describe checks; they do not grant eligibility or mutation.
 */
export interface AssessmentRange {
  readonly code: string;
  readonly inputRefs: readonly InputReference[];
}

export interface ResultMetadata {
  readonly reasonCode: ReasonCode;
  readonly diagnostics: readonly Diagnostic[];

  readonly versions: ProfileVersions;
  readonly checked: readonly AssessmentRange[];
  readonly unchecked: readonly AssessmentRange[];

  readonly inputRefs: readonly InputReference[];
  readonly provenance: readonly Provenance[];

  readonly verificationScope: VerificationScope;
  readonly canonicality: AssessmentState;
  readonly finality: AssessmentState;
}

export interface VerifiedObservationResult extends ResultMetadata {
  readonly operation: "OBSERVATION";
  readonly status: "VERIFIED";

  readonly observations: readonly Observation[];

  readonly mapping?: never;
  readonly successfulActions?: never;
}

export interface VerifiedMappingResult extends ResultMetadata {
  readonly operation: "MAPPING";
  readonly status: "VERIFIED";

  readonly mapping: VerifiedMappingPayload;

  readonly observations?: never;
}

/**
 * Non-VERIFIED results carry diagnostics and references,
 * but no completed Mapping or usable successful-action collection.
 *
 * RESOURCE_LIMIT represents the specified validation budget.
 * It does not define a conversion of internal defects or OOM
 * into an evidence judgment.
 */
export type NonVerifiedResult<
  Operation extends "OBSERVATION" | "MAPPING",
> = {
  readonly [Status in NonVerifiedStatus]: ResultMetadata & {
    readonly operation: Operation;
    readonly status: Status;

    readonly mapping?: never;
    readonly observations?: never;
    readonly successfulActions?: never;
    readonly successfulActionCount?: never;
    readonly outcomeKind?: never;
    readonly commitment?: never;
  };
}[NonVerifiedStatus];

export type ObservationResult =
  | VerifiedObservationResult
  | NonVerifiedResult<"OBSERVATION">;

export type MappingResult =
  | VerifiedMappingResult
  | NonVerifiedResult<"MAPPING">;

/**
 * PROPOSED return-type names for the frozen public APIs.
 * No function implementation or dispatch API is defined here.
 */
export type NormalMappingResult =
  | (
      VerifiedMappingResult & {
        readonly mapping: NormalMappingPayload;
      }
    )
  | NonVerifiedResult<"MAPPING">;

export type SafeMappingResult =
  | (
      VerifiedMappingResult & {
        readonly mapping:
          | SafeSuccessMappingPayload
          | SafeAllRejectedMappingPayload;
      }
    )
  | NonVerifiedResult<"MAPPING">;

export type ERC1271MappingResult =
  | (
      VerifiedMappingResult & {
        readonly mapping: ERC1271MappingPayload;
      }
    )
  | NonVerifiedResult<"MAPPING">;
