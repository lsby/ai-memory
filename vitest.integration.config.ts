import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/integration/**/*.integration.ts'],
    exclude: ['node_modules/**', 'dist/**'],
  },
})
