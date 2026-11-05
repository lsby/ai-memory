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
    include: ['test/integration/**/*.integration.ts'],
    exclude: ['node_modules/**', 'dist/**'],
  },
})
