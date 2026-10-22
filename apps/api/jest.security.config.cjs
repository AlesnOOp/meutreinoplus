/** Dedicated real-PostgreSQL suite; see the fail-closed database guard in the test. */
module.exports = {
  ...require('./jest.e2e.config.cjs'),
  testRegex: '(?:session-(?:isolation|conflicts)|recovery04)\\.security-spec\\.ts$',
};
