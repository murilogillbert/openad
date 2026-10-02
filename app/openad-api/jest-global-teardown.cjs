/**
 * Stops mongodb-memory-server after all suites (Redis is external — see `getRedisTestUrl`).
 */
module.exports = async function globalTeardown() {
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
  const { stopMemoryMongo, stopMemoryRedis } = require('./src/test/memory-mongo.ts');
  await stopMemoryMongo();
  await stopMemoryRedis();
};
