import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'tests/unit/**/*.test.{js,mjs}',
      'tests/property/**/*.test.{js,mjs}',
      'tests/integration/**/*.test.{js,mjs}',
    ],
    testTimeout: 10000,
  },
});
