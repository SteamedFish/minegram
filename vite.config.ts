import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: '/minegram/',
  build: {
    outDir: 'dist',
  },
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    // Vitest's 5000ms default collides with `walkStarBattleBoard`'s own
    // `wallClockMs: 5000` budget: a test that exercises a walk can legally
    // consume the component's entire budget, so the test timeout fires at the
    // same instant the walk gives up. That is a structural collision, not a
    // flake, and it surfaced only on the GitHub runner, which is slower than a
    // developer machine and contended with the rest of the suite. Measured on a
    // warm local machine the worst case in the suite is ~4s (the n=15 exact
    // counter); a walk at n=8 costs ~0.85s locally and can legitimately spend
    // 5s by design. 30s leaves six times the worst legitimate cost as headroom
    // while still failing a genuine hang inside one CI job.
    testTimeout: 30_000,
  },
})
