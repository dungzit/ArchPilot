import { defineConfig } from 'vitest/config'

// Kept separate from vite.config.ts on purpose: the app build must not have to
// load the test runner, and `npm test` must not have to load the React plugin.
export default defineConfig({
  test: {
    // Node is the default because src/domain/*.ts is deliberately
    // framework-free and the contract tests just read files off disk. The one
    // file that needs a DOM (src/app/App.test.tsx, the task-1.1 shell
    // regression test) opts in with a `// @vitest-environment jsdom` docblock,
    // so the fast suites never pay for jsdom start-up.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    reporters: ['default'],
  },
})
