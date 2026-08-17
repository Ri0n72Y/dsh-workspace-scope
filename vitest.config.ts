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
    },
  },
})
