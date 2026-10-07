import { expect } from 'chai'
import type { Log } from 'ethers'
import { PrismaClient } from '@prisma/client'
import { captureSourceEvidence } from '../../../src/services/RawEventsGatherer/sourceEvidence'

const prisma = new PrismaClient()
const CHAIN_ID = 84532n

function makeLog(overrides: Partial<Log> = {}): Log {
  return {
    blockNumber: 123456,
    blockHash: `0x${'AB'.repeat(32)}`,
    transactionHash: `0x${'CD'.repeat(32)}`,
    transactionIndex: 7,
    index: 11,
    address: `0x${'EF'.repeat(20)}`,
    topics: [`0x${'12'.repeat(32)}`],
    data: '0xAABBCC',
    ...overrides,
  } as Log
}

async function resetFixture() {
  await prisma.canonicalSourceEvidence.deleteMany({
    where: { chainId: CHAIN_ID },
  })
}

describe('RawEventsGatherer / canonical source evidence', () => {
  let safe = false

  before(async () => {
    const [{ current_database }] = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`
    if (current_database !== 'caw_pr_b1_test') {
      throw new Error(
        `refusing to run against database "${current_database}" (expected caw_pr_b1_test)`
      )
    }
    safe = true
  })

  beforeEach(async () => {
    if (!safe) throw new Error('refusing to reset fixture before test database safety check')
    await resetFixture()
  })

  after(async () => {
    if (safe) await resetFixture()
    await prisma.$disconnect()
  })

  it('persists one canonicalized source occurrence', async () => {
    await captureSourceEvidence(
      prisma.canonicalSourceEvidence,
      Number(CHAIN_ID),
      makeLog(),
    )

    const rows = await prisma.canonicalSourceEvidence.findMany({
      where: { chainId: CHAIN_ID },
    })

    expect(rows).to.have.length(1)
    expect(rows[0].blockNumber).to.equal(123456n)
    expect(rows[0].blockHash).to.equal(`0x${'ab'.repeat(32)}`)
    expect(rows[0].transactionHash).to.equal(`0x${'cd'.repeat(32)}`)
    expect(rows[0].transactionIndex).to.equal(7)
    expect(rows[0].sourceLogIndex).to.equal(11)
    expect(rows[0].emitter).to.equal(`0x${'ef'.repeat(20)}`)
    expect(rows[0].topics).to.deep.equal([`0x${'12'.repeat(32)}`])
    expect(rows[0].eventData).to.equal('0xaabbcc')
  })

  it('accepts empty source eventData', async () => {
    await captureSourceEvidence(
      prisma.canonicalSourceEvidence,
      Number(CHAIN_ID),
      makeLog({ data: '0x' }),
    )

    const row = await prisma.canonicalSourceEvidence.findFirstOrThrow({
      where: { chainId: CHAIN_ID },
    })

    expect(row.eventData).to.equal('0x')
  })

  for (const invalidData of ['0xabc', 'not-hex']) {
    it(`rejects invalid source eventData ${invalidData} before persistence`, async () => {
      let error: unknown

      try {
        await captureSourceEvidence(
          prisma.canonicalSourceEvidence,
          Number(CHAIN_ID),
          makeLog({ data: invalidData }),
        )
      } catch (err) {
        error = err
      }

      expect(error).to.be.instanceOf(Error)
      expect((error as Error).message).to.equal(
        'RawEventsGatherer: invalid source eventData'
      )

      const count = await prisma.canonicalSourceEvidence.count({
        where: { chainId: CHAIN_ID },
      })
      expect(count).to.equal(0)
    })
  }

  it('treats exact re-observation as idempotent and preserves firstObservedAt', async () => {
    const log = makeLog()

    await captureSourceEvidence(
      prisma.canonicalSourceEvidence,
      Number(CHAIN_ID),
      log,
    )

    const first = await prisma.canonicalSourceEvidence.findFirstOrThrow({
      where: { chainId: CHAIN_ID },
    })

    await new Promise(resolve => setTimeout(resolve, 10))

    await captureSourceEvidence(
      prisma.canonicalSourceEvidence,
      Number(CHAIN_ID),
      log,
    )

    const rows = await prisma.canonicalSourceEvidence.findMany({
      where: { chainId: CHAIN_ID },
    })

    expect(rows).to.have.length(1)
    expect(rows[0].firstObservedAt.getTime()).to.equal(first.firstObservedAt.getTime())
  })

  it('fails closed on contradictory evidence for the same occurrence identity', async () => {
    const original = makeLog()

    await captureSourceEvidence(
      prisma.canonicalSourceEvidence,
      Number(CHAIN_ID),
      original,
    )

    const contradictory = makeLog({
      transactionHash: `0x${'34'.repeat(32)}`,
    })

    let thrown: unknown
    try {
      await captureSourceEvidence(
        prisma.canonicalSourceEvidence,
        Number(CHAIN_ID),
        contradictory,
      )
    } catch (err) {
      thrown = err
    }

    expect(thrown).to.be.instanceOf(Error)
    expect((thrown as Error).message).to.include('contradictory source evidence')

    const rows = await prisma.canonicalSourceEvidence.findMany({
      where: { chainId: CHAIN_ID },
    })

    expect(rows).to.have.length(1)
    expect(rows[0].transactionHash).to.equal(`0x${'cd'.repeat(32)}`)
  })

  it('accepts a P2002 race when the winning row contains identical evidence', async () => {
    const log = makeLog()
    const canonical = {
      blockNumber: 123456n,
      transactionHash: `0x${'cd'.repeat(32)}`,
      transactionIndex: 7,
      emitter: `0x${'ef'.repeat(20)}`,
      topics: [`0x${'12'.repeat(32)}`],
      eventData: '0xaabbcc',
    }

    let reads = 0
    const store = {
      async findUnique() {
        reads += 1
        return reads === 1 ? null : canonical
      },
      async create() {
        throw { code: 'P2002' }
      },
    }

    await captureSourceEvidence(store, Number(CHAIN_ID), log)
    expect(reads).to.equal(2)
  })

  it('fails closed after a P2002 race when the winning row contradicts the observation', async () => {
    const log = makeLog()
    const contradictory = {
      blockNumber: 123456n,
      transactionHash: `0x${'34'.repeat(32)}`,
      transactionIndex: 7,
      emitter: `0x${'ef'.repeat(20)}`,
      topics: [`0x${'12'.repeat(32)}`],
      eventData: '0xaabbcc',
    }

    let reads = 0
    const store = {
      async findUnique() {
        reads += 1
        return reads === 1 ? null : contradictory
      },
      async create() {
        throw { code: 'P2002' }
      },
    }

    let thrown: unknown
    try {
      await captureSourceEvidence(store, Number(CHAIN_ID), log)
    } catch (err) {
      thrown = err
    }

    expect(reads).to.equal(2)
    expect(thrown).to.be.instanceOf(Error)
    expect((thrown as Error).message).to.include('contradictory source evidence')
  })

})
