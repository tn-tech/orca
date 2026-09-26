import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/e2e/workflows/*.e2e.test.ts'],
    // Why: each file owns a whole headless runtime and its worker PTYs.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 240_000
  }
})
