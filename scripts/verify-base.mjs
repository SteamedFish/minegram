#!/usr/bin/env node
/**
 * Verify the built site will work at the nested GitHub Pages base.
 *
 * The deployment is served from a subpath (`/minegram/`), not the domain root,
 * so every local asset the document references has to be prefixed with it. A
 * single root-absolute `src` or `href` is not a cosmetic bug: the Worker, the
 * stylesheet, or the entry chunk silently 404s in production while `npm run
 * dev` and a naive `dist/index.html` read both look fine.
 *
 * This check is deliberately static — it reads the built files instead of
 * starting a server. A live `vite preview` round-trip would be the obvious
 * alternative, but it is the flakiest possible CI step, and the failure mode it
 * guards against is fully decidable from the artefacts themselves. It is also
 * the ONLY place in the project that pins the base path, so `vite.config.ts`'s
 * `base` and this expectation can never drift apart silently.
 *
 * Run after `npm run build`; exits non-zero and prints every violation.
 */
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, sep } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(root, 'dist')
const indexPath = join(distDir, 'index.html')

/** @type {string[]} */
const problems = []

function fail(message) {
  problems.push(message)
}

/**
 * The one source of truth for the deployment path, mirrored from
 * `vite.config.ts`'s `base`. Changing one without the other fails here.
 */
const BASE = '/minegram/'

if (!BASE.startsWith('/') || !BASE.endsWith('/')) {
  fail(`BASE must be a rooted, slash-terminated path, got ${JSON.stringify(BASE)}`)
}

let html
try {
  html = await readFile(indexPath, 'utf8')
} catch {
  fail(`no built index.html at ${indexPath} — run \`npm run build\` first`)
  report()
}

/** Attributes that reference a local asset, and whether it is script-like. */
const REFERENCE = /(?:src|href)\s*=\s*("([^"]*)"|'([^']*)')/g

/** @type {Set<string>} */
const referenced = new Set()

for (const match of html.matchAll(REFERENCE)) {
  const raw = (match[2] ?? match[3] ?? '').trim()
  if (raw === '') {
    fail('an empty src/href in index.html resolves to the page itself')
    continue
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) {
    // An absolute URL with a scheme, or a protocol-relative one. Out of scope:
    // the deployment neither rewrites nor resolves these.
    continue
  }
  if (raw.startsWith('data:')) {
    // The favicon is inlined on purpose, so the nested base never has to
    // resolve a second request for an icon. See index.html.
    continue
  }
  if (raw.startsWith('#')) {
    continue
  }
  referenced.add(raw)
}

if (referenced.size === 0) {
  fail('index.html references no local assets at all — the build is empty or mangled')
}

for (const ref of referenced) {
  if (!ref.startsWith(BASE)) {
    fail(`"${ref}" is not prefixed with the deployment base ${BASE}`)
    continue
  }
  // `/minegram/assets/index-abc.js` -> `dist/assets/index-abc.js`
  const relative = ref.slice(BASE.length).split(/[?#]/)[0]
  if (relative === '') {
    continue
  }
  const target = join(distDir, ...relative.split('/'))
  // Refuse to follow a reference that climbs out of dist.
  if (!target.startsWith(distDir + sep)) {
    fail(`"${ref}" escapes the dist directory`)
    continue
  }
  try {
    const info = await stat(target)
    if (!info.isFile()) {
      fail(`"${ref}" resolves to a directory, not a file`)
    }
  } catch {
    fail(`"${ref}" is referenced by index.html but missing from dist`)
  }
}

/**
 * The entry module is the asset whose path breaks first when `base` is wrong,
 * so assert it explicitly instead of trusting the scrape above to have found it.
 */
if (![...referenced].some((ref) => ref.startsWith(BASE) && ref.endsWith('.js'))) {
  fail(`no JavaScript entry point is served from ${BASE} — check vite.config.ts's base`)
}

report()

function report() {
  if (problems.length === 0) {
    console.log(
      `verify-base: ${referenced.size} local reference(s) all resolve under ${BASE}`,
    )
    return
  }
  console.error(`verify-base: ${problems.length} problem(s) in the built site:`)
  for (const problem of problems) {
    console.error(`  - ${problem}`)
  }
  process.exitCode = 1
}

