/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  // jsdom, not node: @testing-library/react needs a DOM. #59 was written before
  // the component tests existed and still specified node.
  testEnvironment: 'jsdom',
  testPathIgnorePatterns: ['/node_modules/', '/e2e/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { moduleResolution: 'node' } }],
  },
  setupFilesAfterEnv: ['@testing-library/jest-dom'],
}

module.exports = config
