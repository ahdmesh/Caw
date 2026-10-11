// Only R34-owned validated hex strings may enter this internal adapter.
function isHexString(v:unknown,bytes?:number):boolean {
 return typeof v==='string' && v.startsWith('0x') && v.length%2===0 &&
  (bytes===undefined || v.length===2+2*bytes);
}
function validBlockNumber(v:unknown):boolean { return typeof v==='bigint' && v>=0n; }

export type SourceEvidenceIdentity = {
  chainId: bigint
  blockNumber: bigint
  blockHash: string
  transactionHash: string
  transactionIndex: number
  sourceLogIndex: number
  emitter: string
  topics: readonly string[]
  eventData: string
}

export type TransactionIdentity = {
  hash: string
  chainId: bigint
  blockNumber: bigint | null
  blockHash: string | null
  transactionIndex: number | null
  to: string | null
  data: string
}

export type ReceiptIdentity = {
  hash: string
  blockNumber: bigint
  blockHash: string
  index: number
  logs: readonly {
    index: number
    transactionHash: string
    transactionIndex: number
    blockHash: string
    blockNumber: bigint
    address: string
    topics: readonly string[]
    data: string
  }[]
}

export type EvidenceBindingResult =
  | { status: 'VERIFIED' }
  | { status: 'CONTRADICTION'; reason: string }

function equalHex(a: string, b: string, bytes?: number): boolean {
  return isHexString(a, bytes) &&
    isHexString(b, bytes) &&
    a.toLowerCase() === b.toLowerCase()
}

function validIndex(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

export function verifyCanonicalEvidenceBinding(input: {
  source: SourceEvidenceIdentity
  transaction: TransactionIdentity
  receipt: ReceiptIdentity
  expectedChainId: bigint
}): EvidenceBindingResult {
  const { source, transaction: tx, receipt, expectedChainId } = input

  const fail = (reason: string): EvidenceBindingResult => ({
    status: 'CONTRADICTION',
    reason,
  })

  if (
    source.chainId !== expectedChainId ||
    tx.chainId !== expectedChainId
  ) return fail('CHAIN_ID_MISMATCH')

  if (
    !equalHex(source.transactionHash, tx.hash, 32) ||
    !equalHex(source.transactionHash, receipt.hash, 32)
  ) return fail('TRANSACTION_HASH_MISMATCH')

  if (
    !equalHex(source.blockHash, receipt.blockHash, 32) ||
    !equalHex(source.blockHash, tx.blockHash ?? '', 32)
  ) return fail('BLOCK_HASH_MISMATCH')

  if (
    !validBlockNumber(receipt.blockNumber) ||
    tx.blockNumber === null ||
    !validBlockNumber(tx.blockNumber) ||
    source.blockNumber !== receipt.blockNumber ||
    tx.blockNumber !== receipt.blockNumber
  ) return fail('BLOCK_NUMBER_MISMATCH')

  if (
    !validIndex(source.transactionIndex) ||
    !validIndex(receipt.index) ||
    tx.transactionIndex !== receipt.index ||
    source.transactionIndex !== receipt.index
  ) return fail('TRANSACTION_INDEX_MISMATCH')

  if (!validIndex(source.sourceLogIndex)) {
    return fail('INVALID_SOURCE_LOG_INDEX')
  }

  const matching = receipt.logs.filter(
    log => log.index === source.sourceLogIndex,
  )

  if (matching.length !== 1) {
    return fail('SOURCE_LOG_NOT_UNIQUE')
  }

  const log = matching[0]

  if (
    !equalHex(log.transactionHash, source.transactionHash, 32) ||
    log.transactionIndex !== source.transactionIndex ||
    !equalHex(log.blockHash, source.blockHash, 32) ||
    !validBlockNumber(log.blockNumber) ||
    log.blockNumber !== source.blockNumber
  ) return fail('SOURCE_LOG_CONTEXT_MISMATCH')

  if (!equalHex(log.address, source.emitter, 20)) {
    return fail('SOURCE_LOG_EMITTER_MISMATCH')
  }

  if (
    log.topics.length !== source.topics.length ||
    !log.topics.every((topic, i) =>
      equalHex(topic, source.topics[i], 32)
    ) ||
    !equalHex(log.data, source.eventData)
  ) return fail('SOURCE_LOG_CONTENT_MISMATCH')

  return { status: 'VERIFIED' }
}

export type ReceiptEvidenceSetResult =
  | { status: 'VERIFIED' }
  | { status: 'INSUFFICIENT_EVIDENCE'; reason: string }
  | { status: 'CONTRADICTION'; reason: string }

export function verifyReceiptEvidenceSet(input: {
  sources: readonly SourceEvidenceIdentity[]
  transaction: TransactionIdentity
  receipt: ReceiptIdentity
  expectedChainId: bigint
  expectedEmitter: string
  expectedTopic: string
}): ReceiptEvidenceSetResult {
  const { sources, transaction, receipt, expectedChainId } = input
  const fail = (reason: string): ReceiptEvidenceSetResult =>
    ({ status: 'CONTRADICTION', reason })

  if (
    transaction.chainId !== expectedChainId ||
    !equalHex(transaction.hash, receipt.hash, 32) ||
    !equalHex(transaction.blockHash ?? '', receipt.blockHash, 32) ||
    transaction.blockNumber !== receipt.blockNumber ||
    transaction.transactionIndex !== receipt.index
  ) return fail('TRANSACTION_RECEIPT_MISMATCH')

  const indices = new Set<number>()
  for (const log of receipt.logs) {
    if (!validIndex(log.index) || indices.has(log.index)) {
      return fail('RECEIPT_LOG_INDEX_NOT_UNIQUE')
    }
    indices.add(log.index)
    if (
      !equalHex(log.transactionHash, receipt.hash, 32) ||
      log.transactionIndex !== receipt.index ||
      !equalHex(log.blockHash, receipt.blockHash, 32) ||
      log.blockNumber !== receipt.blockNumber
    ) return fail('RECEIPT_LOG_CONTEXT_MISMATCH')
  }

  const events = receipt.logs.filter(log =>
    equalHex(log.address, input.expectedEmitter, 20) &&
    equalHex(log.topics[0] ?? '', input.expectedTopic, 32)
  )

  if (events.length === 0) {
    return {
      status: 'INSUFFICIENT_EVIDENCE',
      reason: 'NO_TARGET_EVENTS',
    }
  }

  const sourceIndices = new Set<number>()
  for (const source of sources) {
    if (sourceIndices.has(source.sourceLogIndex)) {
      return fail('DUPLICATE_SOURCE_EVIDENCE')
    }
    sourceIndices.add(source.sourceLogIndex)
    if (!events.some(log => log.index === source.sourceLogIndex)) {
      return fail('SOURCE_EVENT_NOT_IN_RECEIPT')
    }
  }

  let missingSourceEvidence = false
  for (const event of events) {
    const source = sources.find(s => s.sourceLogIndex === event.index)
    if (!source) {
      missingSourceEvidence = true
      continue
    }
    const result = verifyCanonicalEvidenceBinding({
      source, transaction, receipt, expectedChainId,
    })
    if (result.status !== 'VERIFIED') return result
  }

  if (missingSourceEvidence) {
    return {
      status: 'INSUFFICIENT_EVIDENCE',
      reason: 'SOURCE_EVIDENCE_MISSING',
    }
  }

  return { status: 'VERIFIED' }
}
