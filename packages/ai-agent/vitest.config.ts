import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [
      { find: '@lsby/ai-agent/internal', replacement: path.resolve(import.meta.dirname, 'src/internal.ts') },
      { find: '@lsby/ai-agent', replacement: path.resolve(import.meta.dirname, 'src/index.ts') },
    ],
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['node_modules/', 'test/'],
      thresholds: {
        branches: 73,
        functions: 58,
        lines: 64,
        statements: 64,
      },
    },
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**', 'node_modules/**', 'dist/**'],
  },
})
