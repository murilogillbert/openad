/**
 * Starts mongodb-memory-server once per Jest run (shared by all workers).
 *
 * Without globalSetup, each Jest worker process would start its own in-memory mongod,
 * causing flakiness (download races, port churn, orphaned processes) and frequent crashes.
 *
 * Do not inherit MONGO_TEST_URI from the shell/compose: tests use mongodb-memory-server unless
 * `OPENAD_TEST_MONGO_INTEGRATION=true` (see `src/test/memory-mongo.ts`).
 */
module.exports = async function globalSetup() {
  if (process.env.OPENAD_TEST_MONGO_INTEGRATION !== 'true') {
    process.env.OPENAD_JEST = '1';
    delete process.env.MONGO_TEST_URI;
  }
  // Use ts-node so we can import the TS helper without building.
  const tsnode = require('ts-node');
  tsnode.register({
    transpileOnly: true,
    project: require('path').join(__dirname, 'tsconfig.spec.json'),
    compilerOptions: {
      module: 'commonjs',
      moduleResolution: 'node10',
      esModuleInterop: true,
      skipLibCheck: true,
    },
  });

  const { getMongoTestBaseUri } = require('./src/test/memory-mongo.ts');
  const uri = await getMongoTestBaseUri();

  // Ensure all worker processes reuse the same mongod instead of spawning their own.
  process.env.MONGO_TEST_URI = uri;

  // Ensure modules that require env vars can boot before per-suite overrides.
  // Individual suites (e.g. `createTestApp`) may override these as needed.
  process.env.MONGO_URI = `${uri.replace(/\/$/, '')}/openad_api_jest_global`;
  process.env.JWT_SECRET =
    process.env.JWT_SECRET || 'test-jwt-secret-key-min-32-chars-long!!';
  process.env.JWT_REFRESH_SECRET =
    process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-key-min-32-chars!!';
};

