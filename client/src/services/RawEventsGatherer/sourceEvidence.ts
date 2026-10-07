import { isHexString } from 'ethers'
import type { Log } from 'ethers'
import type { prisma } from '../../prismaClient'

type SourceEvidenceStore = Pick<typeof prisma.canonicalSourceEvidence, 'findUnique' | 'create'>

function canonicalSourceHex(value: string, bytes: number, field: string): string {
  if (!isHexString(value, bytes)) {
    throw new Error(`RawEventsGatherer: invalid ${field}`)
  }
  return value.toLowerCase()
}

function canonicalSourceData(value: string): string {
  if (!isHexString(value, true)) {
    throw new Error('RawEventsGatherer: invalid source eventData')
  }
  return value.toLowerCase()
}

function requireSourceIndex(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`RawEventsGatherer: invalid ${field}`)
  }
  return value
}

export function canonicalizeSourceLog(log: Log) {
  return {
    blockNumber: requireSourceIndex(log.blockNumber, 'source blockNumber'),
    blockHash: canonicalSourceHex(log.blockHash, 32, 'source blockHash'),
    transactionHash: canonicalSourceHex(log.transactionHash, 32, 'source transactionHash'),
    transactionIndex: requireSourceIndex(log.transactionIndex, 'source transactionIndex'),
    sourceLogIndex: requireSourceIndex(log.index, 'source logIndex'),
    emitter: canonicalSourceHex(log.address, 20, 'source emitter'),
    topics: log.topics.map((topic, i) =>
      canonicalSourceHex(topic, 32, `source topic[${i}]`)
    ),
    eventData: canonicalSourceData(log.data),
  }
}

export async function captureSourceEvidence(
  store: SourceEvidenceStore,
  chainId: number,
  log: Log,
): Promise<void> {
  const evidence = canonicalizeSourceLog(log)
  const identity = {
    chainId: BigInt(chainId),
    blockHash: evidence.blockHash,
    sourceLogIndex: evidence.sourceLogIndex,
  }

  const assertMatchingEvidence = (
    existing: {
      blockNumber: bigint
      transactionHash: string
      transactionIndex: number
      emitter: string
      topics: string[]
      eventData: string
    },
  ) => {
    const matches =
      existing.blockNumber === BigInt(evidence.blockNumber) &&
      existing.transactionHash === evidence.transactionHash &&
      existing.transactionIndex === evidence.transactionIndex &&
      existing.emitter === evidence.emitter &&
      existing.topics.length === evidence.topics.length &&
      existing.topics.every((topic, i) => topic === evidence.topics[i]) &&
      existing.eventData === evidence.eventData

    if (!matches) {
      throw new Error(
        `RawEventsGatherer: contradictory source evidence for chainId=${chainId} blockHash=${evidence.blockHash} sourceLogIndex=${evidence.sourceLogIndex}`
      )
    }
  }

  const existing = await store.findUnique({
    where: { chainId_blockHash_sourceLogIndex: identity },
  })

  if (existing) {
    assertMatchingEvidence(existing)
    return
  }

  try {
    await store.create({
      data: {
        ...identity,
        blockNumber: BigInt(evidence.blockNumber),
        transactionHash: evidence.transactionHash,
        transactionIndex: evidence.transactionIndex,
        emitter: evidence.emitter,
        topics: evidence.topics,
        eventData: evidence.eventData,
        firstObservedAt: new Date(),
      },
    })
  } catch (err: any) {
    if (err?.code !== 'P2002') throw err

    const raced = await store.findUnique({
      where: { chainId_blockHash_sourceLogIndex: identity },
    })
    if (!raced) {
      throw new Error(
        `RawEventsGatherer: source evidence vanished after P2002 for chainId=${chainId} blockHash=${evidence.blockHash} sourceLogIndex=${evidence.sourceLogIndex}`
      )
    }
    assertMatchingEvidence(raced)
  }
}
