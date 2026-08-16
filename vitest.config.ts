import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // PGlite 与 QuickJS 都会占用较高的 CPU / WASM 初始化资源；并行执行时会让
    // 单个用例超过 Vitest 默认的 5 秒超时。基础单测以稳定、可重复为优先。
    minWorkers: 1,
    maxWorkers: 1,
    testTimeout: 0,
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
    // 集成演示依赖外部模型服务，不能在默认单元测试中自动执行。
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**', 'node_modules/**', 'dist/**'],
  },
})
