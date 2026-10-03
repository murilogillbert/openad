/** Testes unitarios: logica pura, nucleo HTTP com fetch simulado, formatacao de dinheiro. */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/tests/unit/**/*.test.ts?(x)'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  setupFiles: ['<rootDir>/tests/unit/setup.ts'],
};
