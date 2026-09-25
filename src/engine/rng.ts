export type RandomSeed = number | string

export interface SeededRandom {
  readonly seed: number
  nextUint32(): number
  nextFloat(): number
  nextInt(maxExclusive: number): number
  restart(): SeededRandom
  derive(label: string): SeededRandom
}

function assertSeed(seed: RandomSeed): void {
  if (typeof seed === 'number') {
    if (!Number.isSafeInteger(seed) || seed < 0) {
      throw new RangeError(`numeric seed must be a nonnegative safe integer; received ${String(seed)}`)
    }
    return
  }
  if (typeof seed !== 'string' || seed.length === 0) {
    throw new TypeError('text seed must be a nonempty string')
  }
}

function hashText(text: string): number {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function mixUint32(value: number): number {
  let mixed = value >>> 0
  mixed ^= mixed >>> 16
  mixed = Math.imul(mixed, 2246822507)
  mixed ^= mixed >>> 13
  mixed = Math.imul(mixed, 3266489909)
  mixed ^= mixed >>> 16
  return mixed >>> 0
}

export function normalizeRandomSeed(seed: RandomSeed): number {
  assertSeed(seed)
  return typeof seed === 'number' ? seed >>> 0 : mixUint32(hashText(seed))
}

export function deriveRandomSeed(seed: RandomSeed, label: string): number {
  assertSeed(seed)
  if (typeof label !== 'string' || label.length === 0) {
    throw new TypeError('derived seed label must be a nonempty string')
  }
  return mixUint32(hashText(`${normalizeRandomSeed(seed)}:${label}`))
}

export class SeededRandomGenerator implements SeededRandom {
  readonly seed: number
  private state: number

  constructor(seed: RandomSeed) {
    this.seed = normalizeRandomSeed(seed)
    this.state = this.seed
  }

  nextUint32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let value = this.state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return (value ^ (value >>> 14)) >>> 0
  }

  nextFloat(): number {
    return this.nextUint32() / 0x100000000
  }

  nextInt(maxExclusive: number): number {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 0x100000000) {
      throw new RangeError(
        `maxExclusive must be an integer between 1 and 4294967296; received ${String(maxExclusive)}`,
      )
    }

    const range = 0x100000000
    const usable = range - (range % maxExclusive)
    let value = this.nextUint32()
    while (value >= usable) {
      value = this.nextUint32()
    }
    return value % maxExclusive
  }

  restart(): SeededRandom {
    return new SeededRandomGenerator(this.seed)
  }

  derive(label: string): SeededRandom {
    return new SeededRandomGenerator(deriveRandomSeed(this.seed, label))
  }
}

export function createSeededRandom(seed: RandomSeed): SeededRandom {
  return new SeededRandomGenerator(seed)
}
