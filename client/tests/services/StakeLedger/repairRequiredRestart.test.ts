import { expect } from 'chai'

process.env.CLIENT_ID = '1'

import {
  ensureBooted,
  isRepairRequired,
  _resetForTests,
  _setPrismaForTests,
  _setActionsContractForTests,
} from '../../../src/services/StakeLedger/index'
import { PRECISION } from '../../../src/services/StakeLedger/contractMath'

describe('StakeLedger / repairRequired restart guard', () => {
  beforeEach(() => {
    _resetForTests()
  })

  afterEach(() => {
    _resetForTests()
  })

  it('reads the durable repair guard without booting the full StakeLedger', async () => {
    _setPrismaForTests({
      stakeLedgerState: {
        findUnique: async () => ({ repairRequired: true }),
      },
    } as any)

    expect(await isRepairRequired()).to.equal(true)
  })

  it('treats a missing StakeLedgerState row as not repair-required', async () => {
    _setPrismaForTests({
      stakeLedgerState: {
        findUnique: async () => null,
      },
    } as any)

    expect(await isRepairRequired()).to.equal(false)
  })

  it('restores halted=true from durable repairRequired=true after process-memory reset', async () => {
    const mockPrisma = {
      stakeLedgerState: {
        findUnique: async () => ({
          networkId: 1,
          multiplier: PRECISION.toString(),
          totalCaw: '1234',
          lastBlock: 100n,
          lastLogIndex: 7,
          repairRequired: true,
          updatedAt: new Date(),
        }),
      },
      cawOwnershipCurrent: {
        findMany: async () => [
          { tokenId: 1, ownership: '500' },
        ],
      },
      chainData: {
        findUnique: async () => null,
        upsert: async () => ({}),
      },
    }

    _setPrismaForTests(mockPrisma as any)
    _setActionsContractForTests({
      capState: async () => [0n, 0n],
    })

    const booted = await ensureBooted()

    expect(booted.halted).to.equal(true)
    expect(booted.lastBlock).to.equal(100n)
    expect(booted.lastLogIndex).to.equal(7)
    expect(booted.ownership.get(1)).to.equal(500n)
  })
})
