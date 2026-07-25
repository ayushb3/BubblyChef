// Augment Jest matchers with @testing-library/jest-dom's extended matchers.
// This file is picked up by TypeScript automatically because tsconfig includes
// all *.ts files under src/. The import adds the custom matchers (toHaveAttribute,
// toBeInTheDocument, etc.) to Jest's expect type so editors and tsc do not
// flag them as unknown properties on JestMatchers<HTMLElement>.
import '@testing-library/jest-dom'
