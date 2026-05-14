import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Global timeout for all tests (3 minutes for LLM-heavy tests)
    testTimeout: 180000,

    // Hook timeouts (setup/teardown)
    hookTimeout: 120000,

    // Run tests sequentially (both files and individual tests)
    // This prevents race conditions with shared fixtures
    fileParallelism: false,
    sequence: {
      concurrent: false,
      shuffle: false
    },

    // Retry flaky tests once
    retry: 0,

    // Better error output
    reporters: ['verbose'],

    // Isolation - each test file runs in isolation
    isolate: true,

    // Environment
    environment: 'node',

    // Coverage (optional, for future)
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'tests/**',
        '**/*.test.ts'
      ]
    }
  }
});
