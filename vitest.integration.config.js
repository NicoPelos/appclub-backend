import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.js'],
    setupFiles: ['./src/testSetup.integration.js'],
    hookTimeout: 20000,
    isolate: false,
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
});
