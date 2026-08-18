import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The shared config stays node-env (dsh convention); jsdom specs opt in
    // with a `// @vitest-environment jsdom` pragma on their first line.
    environment: 'node',
    coverage: {
      include: ['src/**'],
      // dynamic.tsx is a generated artifact of index.tsx; counting it twice
      // would dilute the real numbers.
      exclude: ['src/client/dynamic.tsx'],
      reporter: ['text', 'json-summary'],
      // Hard gate, enforced by `pnpm run test:coverage` (CI runs it). The
      // numbers carry headroom below the current 88% lines / 70% branches so
      // small regressions trip the gate, not noise.
      thresholds: {
        lines: 85,
        functions: 85,
        statements: 80,
        branches: 65,
      },
    },
  },
})
