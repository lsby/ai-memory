import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@lsby/ai-agent/internal',
        replacement: path.resolve(import.meta.dirname, '../ai-agent/src/internal.ts'),
      },
      { find: '@lsby/ai-agent', replacement: path.resolve(import.meta.dirname, '../ai-agent/src/index.ts') },
      { find: '@lsby/ai-memory', replacement: path.resolve(import.meta.dirname, 'src/index.ts') },
    ],
  },
  test: {
    minWorkers: 1,
    maxWorkers: 1,
    testTimeout: 300000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['node_modules/', 'test/'],
      thresholds: {
        branches: 64,
        functions: 70,
        lines: 54,
        statements: 54,
      },
    },
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**', 'node_modules/**', 'dist/**'],
  },
})
