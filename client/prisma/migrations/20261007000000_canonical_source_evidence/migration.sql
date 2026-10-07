CREATE TABLE "CanonicalSourceEvidence" (
    "id" BIGSERIAL NOT NULL,
    "chainId" BIGINT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" VARCHAR(66) NOT NULL,
    "transactionHash" VARCHAR(66) NOT NULL,
    "transactionIndex" INTEGER NOT NULL,
    "sourceLogIndex" INTEGER NOT NULL,
    "emitter" VARCHAR(42) NOT NULL,
    "topics" TEXT[] NOT NULL,
    "eventData" TEXT NOT NULL,
    "firstObservedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanonicalSourceEvidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CanonicalSourceEvidence_chainId_blockHash_sourceLogIndex_key"
ON "CanonicalSourceEvidence"("chainId", "blockHash", "sourceLogIndex");

CREATE INDEX "CanonicalSourceEvidence_chainId_blockNumber_transactionInde_idx"
ON "CanonicalSourceEvidence"("chainId", "blockNumber", "transactionIndex", "sourceLogIndex");

CREATE INDEX "CanonicalSourceEvidence_chainId_transactionHash_idx"
ON "CanonicalSourceEvidence"("chainId", "transactionHash");
