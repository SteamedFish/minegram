import { describe, expect, it } from 'vitest'

/**
 * The Star Battle palette is a DERIVED object, not a taste call: the rule in
 * the header of starbattle.css (5 hue slots × 4 lightness levels, chroma at
 * the gamut/S cap) must hold for every board size, and this test is the proof
 * that keeps holding. It reads the shipping stylesheet, converts the 40
 * hsl() fills to CIELAB, and checks the worst pair on every prefix n = 4..20
 * — the promise the palette makes is about the worst pair, because any two
 * regions can end up adjacent.
 *
 * The metric is CIEDE2000; the implementation is pinned first against the
 * Sharma et al. reference pairs so a broken metric fails here, not silently.
 * For large flat patches a ΔE00 around 5 reads clearly at a glance; the
 * floors below are set an honest margin under the measured values (light
 * theme measures 18.0 at n=20, dark 13.7), not at them.
 */

interface Lab {
  readonly L: number
  readonly a: number
  readonly b: number
}

const RAD = Math.PI / 180

function hexToLab(hex: string): Lab {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const X = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047
  const Y = r * 0.2126729 + g * 0.7151522 + b * 0.072175
  const Z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f(X)
  const fy = f(Y)
  const fz = f(Z)
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) }
}

/** CIEDE2000 (Sharma et al. 2005 formulation). */
export function de00(l1: Lab, l2: Lab): number {
  const c1 = Math.hypot(l1.a, l1.b)
  const c2 = Math.hypot(l2.a, l2.b)
  const cAvg = (c1 + c2) / 2
  const g = 0.5 * (1 - Math.sqrt(cAvg ** 7 / (cAvg ** 7 + 25 ** 7)))
  const a1p = l1.a * (1 + g)
  const a2p = l2.a * (1 + g)
  const c1p = Math.hypot(a1p, l1.b)
  const c2p = Math.hypot(a2p, l2.b)
  const h1p = c1p === 0 ? 0 : ((Math.atan2(l1.b, a1p) / RAD) + 360) % 360
  const h2p = c2p === 0 ? 0 : ((Math.atan2(l2.b, a2p) / RAD) + 360) % 360
  const dLp = l2.L - l1.L
  const dCp = c2p - c1p
  let dhp = 0
  if (c1p !== 0 && c2p !== 0) {
    if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p
    else dhp = h2p - h1p > 180 ? h2p - h1p - 360 : h2p - h1p + 360
  }
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin((dhp / 2) * RAD)
  const lAvgP = (l1.L + l2.L) / 2
  const cAvgP = (c1p + c2p) / 2
  let hAvgP: number
  if (c1p === 0 || c2p === 0) hAvgP = h1p + h2p
  else if (Math.abs(h1p - h2p) <= 180) hAvgP = (h1p + h2p) / 2
  else hAvgP = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2
  const t =
    1 -
    0.17 * Math.cos((hAvgP - 30) * RAD) +
    0.24 * Math.cos(2 * hAvgP * RAD) +
    0.32 * Math.cos((3 * hAvgP + 6) * RAD) -
    0.2 * Math.cos((4 * hAvgP - 63) * RAD)
  const dTheta = 30 * Math.exp(-(((hAvgP - 275) / 25) ** 2))
  const rc = 2 * Math.sqrt(cAvgP ** 7 / (cAvgP ** 7 + 25 ** 7))
  const sl = 1 + (0.015 * (lAvgP - 50) ** 2) / Math.sqrt(20 + (lAvgP - 50) ** 2)
  const sc = 1 + 0.045 * cAvgP
  const sh = 1 + 0.015 * cAvgP * t
  const rt = -Math.sin(2 * dTheta * RAD) * rc
  return Math.sqrt((dLp / sl) ** 2 + (dCp / sc) ** 2 + (dHp / sh) ** 2 + rt * (dCp / sc) * (dHp / sh))
}

function hslToHex(h: number, sPct: number, lPct: number): string {
  const s = sPct / 100
  const l = lPct / 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let rgb: readonly number[]
  if (h < 60) rgb = [c, x, 0]
  else if (h < 120) rgb = [x, c, 0]
  else if (h < 180) rgb = [0, c, x]
  else if (h < 240) rgb = [0, x, c]
  else if (h < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  const to = (v: number): string =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${to(rgb[0])}${to(rgb[1])}${to(rgb[2])}`
}

/* The palette lives in CSS by contract, so this test reads the shipping
   stylesheet from disk. The app tsconfig pins types to vite/client (no node
   globals, and pulling @types/node in here would flip setTimeout's return
   type program-wide), so node:fs is reached through process.getBuiltinModule
   with an explicitly-typed globalThis instead of an import. Vitest's ?raw
   pipeline returns an empty string for .css files, which is why this does
   not use import.meta.glob like the layer-boundary guard does. */
interface FsLike {
  readFileSync(path: string, encoding: 'utf8'): string
}
const runtime = globalThis as { process?: { getBuiltinModule?(id: 'node:fs'): FsLike } }
if (runtime.process?.getBuiltinModule === undefined) {
  throw new Error('node:fs unavailable in this test runtime')
}
const css: string = runtime.process.getBuiltinModule('node:fs').readFileSync('src/styles/starbattle.css', 'utf8')

function paletteEntries(theme: 'light' | 'dark'): Lab[] {
  const re = new RegExp(`--star-${theme}-c(\\d+): hsl\\((\\d+) ([\\d.]+)% ([\\d.]+)%\\);`, 'g')
  const out = new Map<number, Lab>()
  for (const m of css.matchAll(re)) {
    out.set(Number(m[1]), hexToLab(hslToHex(Number(m[2]), Number(m[3]), Number(m[4]))))
  }
  expect(out.size, `${theme} palette should declare every index 0..19`).toBe(20)
  return Array.from({ length: 20 }, (_, i) => {
    const lab = out.get(i)
    expect(lab, `${theme} c${i} missing`).toBeDefined()
    return lab as Lab
  })
}

function minPairwise(labs: readonly Lab[], n: number): number {
  let min = Infinity
  for (let a = 0; a < n; a += 1) {
    for (let b = a + 1; b < n; b += 1) {
      min = Math.min(min, de00(labs[a] as Lab, labs[b] as Lab))
    }
  }
  return min
}

describe('starbattle palette — the metric itself', () => {
  it('computes CIEDE2000 to the Sharma reference values', () => {
    expect(de00({ L: 50, a: 2.6772, b: -79.7751 }, { L: 50, a: 0, b: -82.7485 })).toBeCloseTo(2.0425, 3)
    expect(de00({ L: 50, a: 3.1571, b: -77.2803 }, { L: 50, a: 0, b: -82.7485 })).toBeCloseTo(2.8615, 3)
    expect(de00({ L: 50, a: 2.8361, b: -74.02 }, { L: 50, a: 0, b: -82.7485 })).toBeCloseTo(3.4412, 3)
  })
})

describe('starbattle palette — maximum minimum distance, every prefix', () => {
  const light = paletteEntries('light')
  const dark = paletteEntries('dark')

  it('declares 20 complete pairs and nothing outside hsl()', () => {
    for (const theme of ['light', 'dark'] as const) {
      const count = css.match(new RegExp(`--star-${theme}-c\\d+:`, 'g'))?.length ?? 0
      expect(count).toBe(20)
    }
  })

  it('light theme: the worst pair stays far apart from n=4 to n=20', () => {
    expect(minPairwise(light, 4)).toBeGreaterThan(24) // measured 26.4
    expect(minPairwise(light, 5)).toBeGreaterThan(17) // measured 18.4
    expect(minPairwise(light, 10)).toBeGreaterThan(17) // measured 18.4
    expect(minPairwise(light, 15)).toBeGreaterThan(17) // measured 18.4
    expect(minPairwise(light, 20)).toBeGreaterThan(17) // measured 18.0
  })

  it('dark theme: the worst pair stays far apart from n=4 to n=20', () => {
    expect(minPairwise(dark, 4)).toBeGreaterThan(30) // measured 34.3
    expect(minPairwise(dark, 5)).toBeGreaterThan(23) // measured 25.5
    expect(minPairwise(dark, 10)).toBeGreaterThan(16) // measured 17.7
    expect(minPairwise(dark, 15)).toBeGreaterThan(13.5) // measured 14.5
    expect(minPairwise(dark, 20)).toBeGreaterThan(13) // measured 13.7
  })

  it('holds its own against the plate, the glyph ink, and the accent', () => {
    /* Tokens the fills must coexist with (tokens.css), per theme. The glyph
       rides a plate chip and every state ring sits on the plate, so ink and
       accent only ever meet a fill through overlays; the floors reflect that. */
    const contexts = {
      light: { plate: '#fbf8f2', ink: '#1c1a16', accent: '#b23a1b' },
      dark: { plate: '#20242b', ink: '#e8e3d8', accent: '#e2622f' },
    } as const
    for (const [theme, labs] of [
      ['light', light],
      ['dark', dark],
    ] as const) {
      for (const [role, hex] of Object.entries(contexts[theme])) {
        const token = hexToLab(hex)
        const min = Math.min(...labs.map((lab) => de00(token, lab)))
        if (role === 'plate') expect(min, `${theme} plate`).toBeGreaterThan(theme === 'light' ? 18 : 10)
        if (role === 'ink') expect(min, `${theme} ink`).toBeGreaterThan(theme === 'light' ? 22 : 30)
        if (role === 'accent') expect(min, `${theme} accent`).toBeGreaterThan(theme === 'light' ? 9 : 15)
      }
    }
  })
})
