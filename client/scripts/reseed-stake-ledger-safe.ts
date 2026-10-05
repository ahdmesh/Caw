import 'dotenv/config'
import { Contract } from 'ethers'
import { makeJsonRpcProvider, getL2HttpRpcUrl, getL1HttpRpcUrl } from '../src/utils/rpcProvider'
import { cawProfileLedgerAbi, cawProfileAbi } from '../src/abi/generated'
import { CAW_NAMES_L2_ADDRESS, CAW_NAMES_ADDRESS } from '../src/abi/addresses'
import { prisma } from '../src/prismaClient'
import { getNetworkId } from '../src/utils/networkId'

const CURSOR_SENTINEL = 2_147_483_647
const PRECISION = 10n ** 18n
const BATCH = 20

function requireClientId(): number {
  const raw = getNetworkId()
  const n = raw ? Number(raw) : NaN
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error('NETWORK_ID (or legacy CLIENT_ID) required')
  }
  return n
}

async function main() {
  const apply = process.argv.includes('--apply')
  const clientId = requireClientId()

  const l2Url = getL2HttpRpcUrl()
  if (!l2Url) throw new Error('L2 RPC not configured')

  const l1Url = getL1HttpRpcUrl()
  if (!l1Url) throw new Error('L1 RPC not configured')

  const l2Provider = makeJsonRpcProvider(l2Url, 84532)
  const l1Provider = makeJsonRpcProvider(l1Url, 11155111)

  const l2 = new Contract(
    CAW_NAMES_L2_ADDRESS,
    cawProfileLedgerAbi as any,
    l2Provider,
  )

  const l1 = new Contract(
    CAW_NAMES_ADDRESS,
    cawProfileAbi as any,
    l1Provider,
  )

  // Freeze one authoritative L2 point. Every L2 state read below uses H.
  const H = await l2Provider.getBlockNumber()
  const nextId = BigInt(await l1.nextId())
  const maxId = Number(nextId - 1n)

  if (!Number.isSafeInteger(maxId) || maxId < 0) {
    throw new Error(`invalid maxId derived from nextId=${nextId}`)
  }

  console.log(`[safe-reseed] mode=${apply ? 'APPLY' : 'READ ONLY'}`)
  console.log(`  clientId = ${clientId}`)
  console.log(`  H        = ${H}`)
  console.log(`  nextId   = ${nextId}`)
  console.log(`  tokens   = 1..${maxId}`)
  console.log(`  cursor   = (${H}, ${CURSOR_SENTINEL})`)

  const [multiplierRaw, totalCawRaw] = await Promise.all([
    l2.rewardMultiplier({ blockTag: H }),
    l2.totalCaw({ blockTag: H }),
  ])

  const multiplier = BigInt(multiplierRaw)
  const totalCaw = BigInt(totalCawRaw)

  const ownership = new Map<number, bigint>()

  for (let start = 1; start <= maxId; start += BATCH) {
    const end = Math.min(start + BATCH - 1, maxId)
    const ids = Array.from(
      { length: end - start + 1 },
      (_, i) => start + i,
    )

    // No per-token catch: any failed historical read aborts before DB write.
    const values = await Promise.all(
      ids.map(async tokenId => {
        const raw = await l2.cawOwnership(tokenId, { blockTag: H })
        return [tokenId, BigInt(raw)] as const
      }),
    )

    for (const [tokenId, value] of values) {
      // Preserve known zero as a real authoritative state.
      ownership.set(tokenId, value)
    }

    process.stdout.write(`\r  read ${end}/${maxId}`)
  }

  if (maxId > 0) process.stdout.write('\n')

  if (ownership.size !== maxId) {
    throw new Error(
      `ownership scan incomplete: expected=${maxId} actual=${ownership.size}`,
    )
  }

  let nonZero = 0
  let sumOwnership = 0n
  let sumBalances = 0n

  const rows = Array.from(ownership.entries()).map(([tokenId, value]) => {
    if (value !== 0n) nonZero++
    sumOwnership += value

    const balance = (value * multiplier) / PRECISION
    sumBalances += balance

    return {
      tokenId,
      ownership: value,
      balance,
    }
  })

  console.log(`  rewardMultiplier = ${multiplier}`)
  console.log(`  totalCaw         = ${totalCaw}`)
  console.log(`  ownership rows   = ${ownership.size}`)
  console.log(`  non-zero rows    = ${nonZero}`)
  console.log(`  sumOwnership     = ${sumOwnership}`)
  console.log(`  sumBalances      = ${sumBalances}`)
  console.log(`  totalCaw-delta   = ${totalCaw - sumBalances}`)

  if (!apply) {
    console.log('[safe-reseed] READ ONLY complete; DB unchanged')
    return
  }

  // Safety check: every minted token currently has a corresponding User.
  // Do not partially repair User mirrors if the local index is incomplete.
  const users = await prisma.user.findMany({
    where: {
      tokenId: {
        gte: 1,
        lte: maxId,
      },
    },
    select: { tokenId: true },
  })

  const userTokenIds = new Set(users.map(u => u.tokenId))
  const missingUsers = rows
    .map(r => r.tokenId)
    .filter(tokenId => !userTokenIds.has(tokenId))

  if (missingUsers.length > 0) {
    throw new Error(
      `User index incomplete; refusing DB write. Missing tokenIds: ${missingUsers.join(',')}`,
    )
  }

  const now = new Date()

  // One atomic repair:
  // - StakeLedgerState mirrors chain@H
  // - Current contains every token, including authoritative zero rows
  // - User stake mirrors contract-equivalent balance@H
  //
  // CawOwnershipSnapshot is intentionally untouched.
  await prisma.$transaction(async tx => {
    await tx.stakeLedgerState.upsert({
      where: { networkId: clientId },
      create: {
        networkId: clientId,
        multiplier: multiplier.toString(),
        totalCaw: totalCaw.toString(),
        lastBlock: BigInt(H),
        lastLogIndex: CURSOR_SENTINEL,
        repairRequired: false,
      },
      update: {
        multiplier: multiplier.toString(),
        totalCaw: totalCaw.toString(),
        lastBlock: BigInt(H),
        lastLogIndex: CURSOR_SENTINEL,
        repairRequired: false,
        updatedAt: now,
      },
    })

    await tx.cawOwnershipCurrent.deleteMany({})

    if (rows.length > 0) {
      await tx.cawOwnershipCurrent.createMany({
        data: rows.map(r => ({
          tokenId: r.tokenId,
          ownership: r.ownership.toString(),
        })),
      })
    }

    for (const row of rows) {
      await tx.user.update({
        where: { tokenId: row.tokenId },
        data: {
          onChainStakeWei: row.balance.toString(),
          onChainStakeUpdatedAt: now,
        },
      })
    }
  }, { timeout: 30_000 })

  console.log(`[safe-reseed] APPLY PASS: DB atomically reseeded from L2 block ${H}`)
}

main()
  .catch(err => {
    console.error('[safe-reseed] ABORT:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
