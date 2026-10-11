// Integration copy: known malformed-input failures have a distinct identity.
// Internal defects and allocation exceptions are deliberately not wrapped.
export class PackedActionFormatError extends Error {
  readonly reasonCode = "NORMAL_PACKED_ACTIONS_MALFORMED";
}

export type CanonicalActionSlice = {
  ordinal: number
  startOffset: number
  endOffset: number
  bytes: Uint8Array
  actionType: number
  senderId: number
  receiverId: number
  receiverCawonce: number
  networkId: number
  cawonce: number
}

export type StrictActionBatch = {
  actionCount: number
  actions: CanonicalActionSlice[]
}

function requireBytes(
  packed: Uint8Array,
  pos: number,
  length: number,
  field: string,
): void {
  if (
    !Number.isSafeInteger(pos) ||
    !Number.isSafeInteger(length) ||
    pos < 0 ||
    length < 0 ||
    pos > packed.length ||
    length > packed.length - pos
  ) {
    throw new PackedActionFormatError(`Malformed packed actions: truncated ${field}`)
  }
}

function readU16BE(
  packed: Uint8Array,
  pos: number,
  field: string,
): number {
  requireBytes(packed, pos, 2, field)
  return (packed[pos] << 8) | packed[pos + 1]
}

function readU32BE(
  packed: Uint8Array,
  pos: number,
  field: string,
): number {
  requireBytes(packed, pos, 4, field)
  return (
    packed[pos] * 0x1000000 +
    packed[pos + 1] * 0x10000 +
    packed[pos + 2] * 0x100 +
    packed[pos + 3]
  )
}

function parseOneAction(
  packed: Uint8Array,
  pos: number,
  ordinal: number,
): CanonicalActionSlice {
  const startOffset = pos

  // actionType(1) + senderId(4) + receiverId(4) +
  // receiverCawonce(4) + networkId(4) + cawonce(4) + rc(1) + ac(1)
  requireBytes(packed, pos, 23, `action ${ordinal} fixed fields`)

  const actionType = packed[startOffset]
  const senderId = readU32BE(
    packed, startOffset + 1, `action ${ordinal} senderId`,
  )
  const receiverId = readU32BE(
    packed, startOffset + 5, `action ${ordinal} receiverId`,
  )
  const receiverCawonce = readU32BE(
    packed, startOffset + 9, `action ${ordinal} receiverCawonce`,
  )
  const networkId = readU32BE(
    packed, startOffset + 13, `action ${ordinal} networkId`,
  )
  const cawonce = readU32BE(
    packed, startOffset + 17, `action ${ordinal} cawonce`,
  )

  const rc = packed[startOffset + 21]
  const ac = packed[startOffset + 22]
  pos += 23

  const recipientsLength = rc * 4
  requireBytes(packed, pos, recipientsLength, `action ${ordinal} recipients`)
  pos += recipientsLength

  const amountsLength = ac * 8
  requireBytes(packed, pos, amountsLength, `action ${ordinal} amounts`)
  pos += amountsLength

  const textLength = readU16BE(packed, pos, `action ${ordinal} text length`)
  pos += 2

  requireBytes(packed, pos, textLength, `action ${ordinal} text`)
  pos += textLength

  return {
    ordinal,
    startOffset,
    endOffset: pos,
    bytes: packed.slice(startOffset, pos),
    actionType,
    senderId,
    receiverId,
    receiverCawonce,
    networkId,
    cawonce,
  }
}

export function parseStrictActionBatch(packed: Uint8Array): StrictActionBatch {
  const actionCount = readU16BE(packed, 0, 'action count')

  if (actionCount < 1 || actionCount > 256) {
    throw new PackedActionFormatError(`Malformed packed actions: invalid action count ${actionCount}`)
  }

  const actions: CanonicalActionSlice[] = []
  let pos = 2

  for (let ordinal = 0; ordinal < actionCount; ordinal += 1) {
    const action = parseOneAction(packed, pos, ordinal)
    actions.push(action)
    pos = action.endOffset
  }

  if (pos !== packed.length) {
    throw new PackedActionFormatError(
      `Malformed packed actions: trailing bytes (${packed.length - pos})`,
    )
  }

  return { actionCount, actions }
}

export type StrictActionGroup = {
  groupOrdinal: number
  groupSize: number
  headerOffset: number
  startOffset: number
  endOffset: number
  bytes: Uint8Array
  actions: CanonicalActionSlice[]
}

export type StrictGroupedActionBatch = {
  groups: StrictActionGroup[]
}

export function parseStrictGroupedActionBatch(
  packed: Uint8Array,
): StrictGroupedActionBatch {
  const groups: StrictActionGroup[] = []
  let pos = 0
  let actionOrdinal = 0

  while (pos < packed.length) {
    const groupOrdinal = groups.length
    const headerOffset = pos
    const groupSize = readU16BE(
      packed,
      pos,
      `group ${groupOrdinal} size`,
    )
    pos += 2

    if (groupSize < 1) {
      throw new PackedActionFormatError(
        `Malformed packed actions: invalid group ${groupOrdinal} size ${groupSize}`,
      )
    }

    const startOffset = pos
    const actions: CanonicalActionSlice[] = []

    for (let i = 0; i < groupSize; i += 1) {
      const action = parseOneAction(packed, pos, actionOrdinal)
      actions.push(action)
      pos = action.endOffset
      actionOrdinal += 1
    }

    const endOffset = pos

    groups.push({
      groupOrdinal,
      groupSize,
      headerOffset,
      startOffset,
      endOffset,
      bytes: packed.slice(startOffset, endOffset),
      actions,
    })
  }

  if (groups.length === 0) {
    throw new PackedActionFormatError('Malformed packed actions: no groups')
  }

  return { groups }
}
