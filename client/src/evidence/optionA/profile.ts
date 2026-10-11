import type {
  Budget,
  ProfileKind,
  ProfileVersions,
  Scope,
} from "./types";

/**
 * Option A internal profile registration.
 *
 * Do not re-export this module through the public API barrel.
 *
 * Source anchors and ABI declarations were supplied as verified
 * reference material in PRB-R15. This module does not verify deployed
 * bytecode, fetch source files or generate a complete contract ABI.
 *
 * Only module-local static data is frozen during module initialization.
 */

type BudgetLimits = Readonly<
  Omit<Budget, "inputRef" | "version" | "provenance">
>;

type BudgetField = keyof BudgetLimits;

interface ContractReference {
  readonly path: string;
  readonly gitBlobSha: string;
}

interface ProfileSource {
  readonly repository: string;
  readonly commit: string;
  readonly contracts: {
    readonly CawActions: ContractReference;
    readonly CawActionsERC1271: ContractReference;
  };
}

interface TargetAbi {
  readonly kind: "TARGETED_HUMAN_READABLE_FRAGMENTS";
  readonly CawActions: readonly string[];
  readonly CawActionsERC1271: readonly string[];
}

interface AccountingReference {
  readonly budgetVersion: string;
  readonly specification: "PRB-R12 C/D";
  readonly origin: "PROPOSED_IMPLEMENTATION_RULE";
  readonly inputModel: "SCHEMA_ORDERED_TAGGED_LOGICAL_SIZE";
  readonly auxiliaryModel: "LIVE_RESERVED_LOGICAL_CAPACITY";
  readonly heapOrRssGuarantee: false;
}

interface RegisteredProfile {
  readonly versions: Readonly<ProfileVersions>;
  readonly kinds: readonly ProfileKind[];
  readonly source: ProfileSource;
  readonly abi: TargetAbi;
  readonly rulesReferences: readonly string[];
  readonly limits: BudgetLimits;
  readonly accounting: AccountingReference;
}

type ProfileMatch =
  | {
      readonly status: "MATCHED";
      readonly profile: RegisteredProfile;
    }
  | {
      readonly status: "UNSUPPORTED";
      readonly reasonCode:
        | "PROFILE_VERSION_UNSUPPORTED"
        | "BUDGET_VALUES_UNSUPPORTED";
    }
  | {
      readonly status: "CONTRADICTED";
      readonly reasonCode: "PROFILE_INPUT_INVALID";
      readonly field: string;
    };

const VERSIONS: Readonly<ProfileVersions> = Object.freeze({
  abi: "optiona-abi-97cd13f3-targets-v1",
  rules: "optiona-rules-i07-v1",
  budget: "optiona-budget-i07-r12-v1",
});

const LIMITS: BudgetLimits = Object.freeze({
  maxCalldataBytes: 1048576,
  maxPackedActionBytes: 1048576,
  maxLogicalInputBytes: 8388608,

  maxReceiptLogs: 4096,
  maxSourceRecords: 4096,
  maxLogTopics: 4,

  maxNormalSafeActions: 256,
  maxNormalSafeGroups: 256,

  maxERC1271Groups: 1024,
  maxERC1271Actions: 4096,
  maxERC1271GroupSize: 65535,

  maxSafeDPStates: 66049,
  maxSafeDPWorkUnits: 262144,
  maxReasonByteComparisons: 16777216,

  maxAuxiliaryBufferBytes: 33554432,
  maxDiagnostics: 32,
});

const BUDGET_FIELDS: readonly BudgetField[] = Object.freeze([
  "maxCalldataBytes",
  "maxPackedActionBytes",
  "maxLogicalInputBytes",

  "maxReceiptLogs",
  "maxSourceRecords",
  "maxLogTopics",

  "maxNormalSafeActions",
  "maxNormalSafeGroups",

  "maxERC1271Groups",
  "maxERC1271Actions",
  "maxERC1271GroupSize",

  "maxSafeDPStates",
  "maxSafeDPWorkUnits",
  "maxReasonByteComparisons",

  "maxAuxiliaryBufferBytes",
  "maxDiagnostics",
]);

const SOURCE: ProfileSource = Object.freeze({
  repository: "GilgameshCaw/Caw",
  commit: "97cd13f3a1423f702d411472fdd2b2a2e7bfbd59",
  contracts: Object.freeze({
    CawActions: Object.freeze({
      path: "solidity/contracts/CawActions.sol",
      gitBlobSha: "d85f0a3b8d374899c6e293bada5548a2b9e4e6fe",
    }),
    CawActionsERC1271: Object.freeze({
      path: "solidity/contracts/CawActionsERC1271.sol",
      gitBlobSha: "bfe0a0ca30975259f41e4ecd578ec391612fcef6",
    }),
  }),
});

const ACTIONS_PROCESSED =
  "event ActionsProcessed(" +
  "uint32 indexed networkId, " +
  "uint32 indexed validatorId, " +
  "uint16 actionCount, " +
  "bytes32 batchHash)";

const ABI: TargetAbi = Object.freeze({
  kind: "TARGETED_HUMAN_READABLE_FRAGMENTS",
  CawActions: Object.freeze([
    "function processActions(" +
      "uint32 validatorId, " +
      "bytes packedActions, " +
      "bytes sigs, " +
      "uint256 withdrawFee, " +
      "uint256 withdrawLzTokenAmount) payable",

    "function safeProcessActions(" +
      "uint32 validatorId, " +
      "bytes packedActions, " +
      "bytes sigs, " +
      "uint256 withdrawFee, " +
      "uint256 withdrawLzTokenAmount) payable " +
      "returns (uint256 successCount, bytes[] rejections)",

    ACTIONS_PROCESSED,

    "event ActionRejected(" +
      "uint32 senderId, " +
      "uint32 cawonce, " +
      "bytes reason)",
  ]),
  CawActionsERC1271: Object.freeze([
    "function processActionsERC1271(" +
      "uint32 validatorId, " +
      "bytes packedActions, " +
      "bytes[] sigs, " +
      "bytes32[] rs, " +
      "uint256 withdrawFee, " +
      "uint256 withdrawLzTokenAmount) payable",

    ACTIONS_PROCESSED,
  ]),
});

const ACCOUNTING: AccountingReference = Object.freeze({
  budgetVersion: VERSIONS.budget,
  specification: "PRB-R12 C/D",
  origin: "PROPOSED_IMPLEMENTATION_RULE",
  inputModel: "SCHEMA_ORDERED_TAGGED_LOGICAL_SIZE",
  auxiliaryModel: "LIVE_RESERVED_LOGICAL_CAPACITY",
  heapOrRssGuarantee: false,
});

/**
 * The sole registered profile.
 *
 * Additional semantic constraints remain in the relevant validators:
 * - NORMAL/SAFE groups <= actions.
 * - ERC1271 groupSize is positive and within the total-action budget.
 *
 * The numeric limits do not replace those constraints.
 */
const INITIAL_PROFILE: RegisteredProfile = Object.freeze({
  versions: VERSIONS,
  kinds: Object.freeze<ProfileKind[]>([
    "NORMAL",
    "SAFE",
    "ERC1271",
  ]),
  source: SOURCE,
  abi: ABI,
  rulesReferences: Object.freeze([
    "Phase I-07",
    "Phase I-05: details not superseded by Phase I-07",
    "PRB-R07: required Observation context",
  ]),
  limits: LIMITS,
  accounting: ACCOUNTING,
});

function isRecord(value: unknown): value is object {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

/**
 * Required matching fields must be own data properties.
 * Missing properties and accessors return undefined.
 * Accessor getters are never invoked here.
 *
 * Arbitrary Proxy objects are outside this data-object boundary.
 */
function ownDataValue(record: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);

  if (descriptor === undefined || !("value" in descriptor)) {
    return undefined;
  }

  return descriptor.value;
}

function invalid(field: string): ProfileMatch {
  return Object.freeze({
    status: "CONTRADICTED",
    reasonCode: "PROFILE_INPUT_INVALID",
    field,
  });
}

/**
 * Internal, synchronous profile lookup.
 *
 * Validates only version fields and the sixteen budget numbers.
 * It does not validate Scope emitters, expectedChainId, inputRef,
 * provenance, resource consumption or evidence content.
 *
 * MATCHED is not an Observation VERIFIED result.
 * No caller-owned object is retained or returned.
 *
 * @internal
 */
export function matchProfile(
  versions: Scope["versions"],
  budget: Budget,
): ProfileMatch {
  if (!isRecord(versions)) {
    return invalid("scope.versions");
  }

  if (!isRecord(budget)) {
    return invalid("budget");
  }

  const abi = ownDataValue(versions, "abi");
  const rules = ownDataValue(versions, "rules");
  const budgetVersion = ownDataValue(versions, "budget");
  const declaredBudgetVersion = ownDataValue(budget, "version");

  if (typeof abi !== "string") {
    return invalid("scope.versions.abi");
  }

  if (typeof rules !== "string") {
    return invalid("scope.versions.rules");
  }

  if (typeof budgetVersion !== "string") {
    return invalid("scope.versions.budget");
  }

  if (typeof declaredBudgetVersion !== "string") {
    return invalid("budget.version");
  }

  let budgetMismatch = false;

  for (const field of BUDGET_FIELDS) {
    const value = ownDataValue(budget, field);

    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value <= 0
    ) {
      return invalid(`budget.${field}`);
    }

    if (value !== LIMITS[field]) {
      budgetMismatch = true;
    }
  }

  if (
    abi !== VERSIONS.abi ||
    rules !== VERSIONS.rules ||
    budgetVersion !== VERSIONS.budget ||
    declaredBudgetVersion !== VERSIONS.budget
  ) {
    return Object.freeze({
      status: "UNSUPPORTED",
      reasonCode: "PROFILE_VERSION_UNSUPPORTED",
    });
  }

  if (budgetMismatch) {
    return Object.freeze({
      status: "UNSUPPORTED",
      reasonCode: "BUDGET_VALUES_UNSUPPORTED",
    });
  }

  return Object.freeze({
    status: "MATCHED",
    profile: INITIAL_PROFILE,
  });
}
