/**
 * Tests for board signatures and the diversity window (`./signature.ts`).
 *
 * The hand-fixture pins below are the aggregate regression pin for the
 * whole measurement chain: they fix k, the witness, the witness's wave
 * count, the first-star wave, the base freebies, and the structural core
 * score in one tuple per board, so a silent change anywhere in
 * catalogue/minimumBasis/structure moves a pin and fails here. Values were
 * measured 2026-10-07 under the matching engine; the K1/K2 boards' minimum
 * bases are hand-derived in `minimumBasis.test.ts`, and every relationship
 * asserted here is re-derived from the independent public measurements
 * rather than assumed.
 */
import { describe, expect, it } from 'vitest'
import { solveStarCatalogue, type StarCatalogueRule } from './catalogue'
import {
  HAND_K0_COLOURS,
  HAND_K1_COLOURS,
  HAND_K2_COLOURS,
  HAND_KMINUS1_COLOURS,
} from './fixtures/handBoards'
import { measureMinimumBasis } from './minimumBasis'
import {
  STAR_SIGNATURE_WINDOW_BOARDS,
  createStarSignatureWindow,
  measureStarBoardSignature,
  recordStarSignature,
  starSignatureKey,
  starSignatureWindowStats,
} from './signature'

/** The pinned signature tuples, measured 2026-10-07 under the matching engine. */
const PINS: ReadonlyArray<{
  readonly name: string
  readonly colours: Uint8Array
  readonly n: number
  readonly signature: {
    readonly k: number
    readonly witness: readonly string[]
    readonly witnessWaves: number
    readonly firstStarWave: number
    readonly baseFreebies: number
    readonly coreScore: number
  }
  readonly key: string
}> = [
  {
    name: 'HAND_K0 (n = 4 starter construction, k = 0)',
    colours: HAND_K0_COLOURS,
    n: 4,
    signature: { k: 0, witness: [], witnessWaves: 3, firstStarWave: 1, baseFreebies: 12, coreScore: 5 },
    key: '0||3|1|12|5',
  },
  {
    name: 'HAND_K1 (n = 4, k = 1, witness c1)',
    colours: HAND_K1_COLOURS,
    n: 4,
    signature: { k: 1, witness: ['c1'], witnessWaves: 4, firstStarWave: 2, baseFreebies: 0, coreScore: 5 },
    key: '1|c1|4|2|0|5',
  },
  {
    name: 'HAND_K2 (n = 4, k = 2, witness c1+c4)',
    colours: HAND_K2_COLOURS,
    n: 4,
    signature: { k: 2, witness: ['c1', 'c4'], witnessWaves: 4, firstStarWave: 3, baseFreebies: 0, coreScore: 4 },
    key: '2|c1+c4|4|3|0|4',
  },
  {
    name: 'HAND_KMINUS1 (n = 10, k = -1)',
    colours: HAND_KMINUS1_COLOURS,
    n: 10,
    signature: { k: -1, witness: [], witnessWaves: 3, firstStarWave: 2, baseFreebies: 0, coreScore: 5 },
    key: '-1||3|2|0|5',
  },
]

describe('measureStarBoardSignature', () => {
  it('pins the full signature tuple on the hand-derived fixtures', () => {
    for (const pin of PINS) {
      const signature = measureStarBoardSignature(pin.colours, pin.n)
      expect(signature.k, pin.name).toBe(pin.signature.k)
      expect(signature.witness, pin.name).toEqual(pin.signature.witness)
      expect(signature.witnessWaves, pin.name).toBe(pin.signature.witnessWaves)
      expect(signature.firstStarWave, pin.name).toBe(pin.signature.firstStarWave)
      expect(signature.baseFreebies, pin.name).toBe(pin.signature.baseFreebies)
      expect(signature.coreScore, pin.name).toBe(pin.signature.coreScore)
      expect(starSignatureKey(signature), pin.name).toBe(pin.key)
    }
  })

  it('agrees with the independent measurements on every component', () => {
    for (const pin of PINS) {
      const signature = measureStarBoardSignature(pin.colours, pin.n)
      const basis = measureMinimumBasis(pin.colours, pin.n)
      expect(signature.k, pin.name).toBe(basis.k)
      expect([...signature.witness], pin.name).toEqual([...basis.rules])
      expect(signature.witnessWaves, pin.name).toBe(basis.waves)

      // firstStarWave comes from the witness re-run and is bounded by its waves.
      const witnessRules: readonly StarCatalogueRule[] =
        basis.k === -1 ? ['base', 'c1', 'c2', 'c3', 'c4'] : ['base', ...basis.rules]
      const witnessRun = solveStarCatalogue(pin.colours, pin.n, { rules: witnessRules, csDepth: 0 })
      expect(signature.firstStarWave, pin.name).toBe(witnessRun.firstStarWave)
      expect(signature.firstStarWave, pin.name).toBeLessThanOrEqual(witnessRun.waves)

      // baseFreebies is the blank count of the independent base-only run.
      const baseRun = solveStarCatalogue(pin.colours, pin.n, { rules: ['base'], csDepth: 0 })
      let blanks = 0
      for (const mark of baseRun.marks) {
        if (mark === 1) {
          blanks += 1
        }
      }
      expect(signature.baseFreebies, pin.name).toBe(blanks)
    }
  })

  it('treats a passed-in basis as the measurement, re-running nothing differently', () => {
    for (const pin of PINS) {
      const basis = measureMinimumBasis(pin.colours, pin.n)
      const withBasis = measureStarBoardSignature(pin.colours, pin.n, basis)
      const withoutBasis = measureStarBoardSignature(pin.colours, pin.n)
      expect(withBasis).toEqual(withoutBasis)
    }
  })

  it('is deterministic and does not mutate the input', () => {
    for (const pin of PINS) {
      const snapshot = pin.colours.slice()
      const first = measureStarBoardSignature(pin.colours, pin.n)
      const second = measureStarBoardSignature(pin.colours, pin.n)
      expect(second).toEqual(first)
      expect([...pin.colours]).toEqual([...snapshot])
    }
  })

  it('rejects invalid input loudly', () => {
    expect(() => measureStarBoardSignature(new Uint8Array(3), 4)).toThrow(RangeError)
    expect(() => measureStarBoardSignature(HAND_K0_COLOURS, 4.5)).toThrow(TypeError)
    expect(() => measureStarBoardSignature(HAND_K0_COLOURS, 3)).toThrow(RangeError)
  })

  it('reads baseFreebies as 0 exactly when the base rules place no star', () => {
    // Structural fact the freebie count rests on: blanks only follow placed
    // stars, so a board whose base run places nothing has no base freebies.
    // The k >= 1 fixtures above all show 0; here the base run is re-verified
    // to have placed nothing, making the pin an implication, not a coincidence.
    for (const pin of PINS.filter((p) => p.signature.k !== 0)) {
      const baseRun = solveStarCatalogue(pin.colours, pin.n, { rules: ['base'], csDepth: 0 })
      expect(baseRun.placed, pin.name).toBe(0)
      expect(pin.signature.baseFreebies, pin.name).toBe(0)
    }
    // And the k = 0 fixture's freebies are the full non-star cell count.
    const k0 = PINS[0]
    expect(k0.signature.baseFreebies).toBe(k0.n * k0.n - k0.n)
  })
})

describe('starSignatureKey', () => {
  it('is deterministic, distinct per tuple, and mirrors every component', () => {
    const keys = PINS.map((pin) => starSignatureKey(measureStarBoardSignature(pin.colours, pin.n)))
    expect(new Set(keys).size).toBe(keys.length)
    const k0 = starSignatureKey(measureStarBoardSignature(HAND_K0_COLOURS, 4))
    expect(k0.split('|')).toEqual(['0', '', '3', '1', '12', '5'])
  })
})

describe('the signature window', () => {
  it('createStarSignatureWindow validates its size', () => {
    expect(createStarSignatureWindow().maxBoards).toBe(STAR_SIGNATURE_WINDOW_BOARDS)
    expect(() => createStarSignatureWindow(0)).toThrow(RangeError)
    expect(() => createStarSignatureWindow(1.5)).toThrow(RangeError)
    expect(() => createStarSignatureWindow(-1)).toThrow(RangeError)
  })

  it('records keys immutably and trims to the window size', () => {
    const window = createStarSignatureWindow(3)
    const w1 = recordStarSignature(window, 'a')
    const w2 = recordStarSignature(w1, 'b')
    const w3 = recordStarSignature(w2, 'c')
    const w4 = recordStarSignature(w3, 'd')
    // Earlier windows are untouched (persistence, not mutation).
    expect(window.entries).toEqual([])
    expect(w1.entries).toEqual(['a'])
    expect(w2.entries).toEqual(['a', 'b'])
    expect(w3.entries).toEqual(['a', 'b', 'c'])
    // Oldest drops first.
    expect(w4.entries).toEqual(['b', 'c', 'd'])
  })

  it('stats: empty reads 0 share, uniform reads 1.0, mixed reads the modal count', () => {
    const empty = starSignatureWindowStats(createStarSignatureWindow(4))
    expect(empty).toEqual({
      boards: 0,
      modalSignature: null,
      modalCount: 0,
      modalSignatureShare: 0,
    })

    let window = createStarSignatureWindow(4)
    for (let i = 0; i < 4; i += 1) {
      window = recordStarSignature(window, 'same')
    }
    const uniform = starSignatureWindowStats(window)
    expect(uniform.modalSignature).toBe('same')
    expect(uniform.modalCount).toBe(4)
    expect(uniform.modalSignatureShare).toBe(1)

    window = createStarSignatureWindow(8)
    for (const key of ['a', 'b', 'a', 'c', 'd', 'b', 'e', 'a']) {
      window = recordStarSignature(window, key)
    }
    const mixed = starSignatureWindowStats(window)
    expect(mixed.boards).toBe(8)
    expect(mixed.modalSignature).toBe('a')
    expect(mixed.modalCount).toBe(3)
    expect(mixed.modalSignatureShare).toBe(3 / 8)
  })

  it('a full window of four pairs reads modal share 0.5 — the target boundary', () => {
    let window = createStarSignatureWindow(8)
    for (const key of ['a', 'b', 'a', 'b', 'c', 'd', 'c', 'd']) {
      window = recordStarSignature(window, key)
    }
    const stats = starSignatureWindowStats(window)
    expect(stats.modalCount).toBe(2)
    expect(stats.modalSignatureShare).toBe(0.25)
  })
})

describe('the signature never feeds the descent', () => {
  it('walk.ts has no import path to the signature module', async () => {
    // Load-bearing guard for the boundary in signature.ts's module doc: the
    // descent must not see the signature, or the non-monotone search the
    // whole finding warns about comes back. A comment mentioning the word
    // is fine; an import (static or dynamic) is not.
    const source: { default: string } = await import('./walk.ts?raw')
    expect(source.default).not.toMatch(/['"]\.\/signature['"]/)
    expect(source.default).not.toMatch(/import\(['"][^'"]*signature/)
  })

  it('walk.ts never mentions the signature at all', async () => {
    // Stricter than the import guard: any reference (even a comment) forces
    // a conscious decision at this guard, which is the point.
    const source: { default: string } = await import('./walk.ts?raw')
    expect(source.default).not.toMatch(/signature/i)
  })
})
