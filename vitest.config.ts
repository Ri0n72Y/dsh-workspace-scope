import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The shared config stays node-env (dsh convention); jsdom specs opt in
    // with a `// @vitest-environment jsdom` pragma on their first line.
    environment: 'node',
  },
})
