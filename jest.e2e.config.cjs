const common = require('./jest.base.cjs');

module.exports = {
  ...common,
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.e2e-spec.ts'],
};
