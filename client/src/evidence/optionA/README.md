# Option A — NORMAL action evidence

Public entry: `mapNormal(input: MappingInput): NormalMappingResult`, exported
by this directory's `index.ts`. It uses only supplied evidence and creates the
owned inputs, shared counter and intermediate results within one invocation.
No runtime service imports this module as part of this change.

## Source and scope

Repository baseline: `97cd13f3a1423f702d411472fdd2b2a2e7bfbd59`.
Source artifact: `CAW_PRB_NORMAL_Mapping_Integration_20261012.zip`.
SHA-256: `e56caa1fbc6f4473ef0bff6dceaba27dcdb14852f588a47b86347b054aee2cee`.
The fourteen implementation files come from that artifact's `NORMAL_MAPPING/src/`.
Relative `.ts` import extensions are removed to match the client build.
Parser format errors, Binding-first checks, partial KNOWN_PAIR versus BOUND,
SourceIdentity, provenance, STOP/ABORTED and single parser/consumer execution
are retained. The signature parser is already included in `association.ts`.
The R23 binding adapter preserves bigint block numbers and accepts only owned,
previously validated inputs; it is not a standalone raw-input validator.

NORMAL only: no SAFE/ERC1271 Mapping, Source Evidence persistence, Prisma
schema/migration, RawEventsGatherer changes, PRA integration or Ledger mutation.
Existing broader type/profile declarations do not implement those other paths.

## Guarantees and limits

VERIFIED establishes correspondence and commitment within provided evidence.
`verificationScope` is `PROVIDED_EVIDENCE_ONLY`; canonicality and finality are
`NOT_ASSESSED`. Cryptographic signature verification, chain execution replay,
eligibility and mutation authorization are not established.

Input logical limit: 8,388,608 bytes. Shared auxiliary logical limit:
33,554,432 bytes. Reservations precede modeled copies and outputs; rejected
reservations stop additional evidence scanning. Internal exceptions abort and
propagate, rather than becoming evidence contradictions.

R37 final acceptance: RESOURCE_ACCEPTED_WITH_LIMITS. I-05 explicitly excludes
JS engine object overhead, ethers internal allocation and process RSS from the
logical-buffer guarantee. This is not a physical heap/RSS or timing bound.
Historical comments and unchecked library-bound labels are retained as truthful
limits, not as proof of a remaining functional failure. No library allocation
upper bound is claimed. Conservative reservations can reject valid evidence.

## Verification from client/

Use the existing client dependencies. Tested versions: Node.js 24.19.0,
TypeScript 5.9.3, ethers 6.15.0, tsx 4.11.0 and Mocha 10.4.0.

```sh
node node_modules/typescript/bin/tsc -p tsconfig.optiona.json
node node_modules/typescript/bin/tsc -p tests/evidence/optionA/typecheck/tsconfig.negative.json
node --import=tsx node_modules/mocha/bin/mocha.js tests/evidence/optionA/normalMapping.test.ts
```

The negative command must exit 2 with exactly five errors: TS2322 at lines
9, 12, 17 and 19; TS2554 at line 15 of negative-type-contracts.ts. It is a
separate negative check, not part of a successful compiler invocation.
Strict checking includes exactOptionalPropertyTypes and noEmit. The runtime
suite preserves 47 integration, 29 Binding and 12 counter cases (88 total).
The .mjs runners use a test-only createRequire bridge for the client's tsx/CJS
context; no package-wide ESM change is needed. The R33 callback fixture remains
test-only. An optional OPTIONA_EVIDENCE_DIR records each child runner's JSON.

The dedicated check extends the unchanged client tsconfig and checks the ported
module and type contract. It does not certify a full-repository build, deployment
or runtime integration. Exact existing lockfile resolution was not verified.
