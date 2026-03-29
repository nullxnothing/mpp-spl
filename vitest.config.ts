import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    // Use the TypeScript source directly via vitest's built-in esbuild transform
    // Test files importing from dist/ use the pre-built ESM output
    testTimeout: 15000,
  },
  resolve: {
    // Ensure .js extension resolution works for ESM imports in dist/
    conditions: ['import', 'default'],
  },
});
