// Mutation testing de findPrecioVigente contra Mongo real (#263). Se corre a mano:
//   MONGO_URI='mongodb://localhost:27018/appcarc_test?replicaSet=rs0' npx stryker run stryker.integration.config.mjs
// concurrency 1: todos los tests de integración comparten la misma base y la vacían en afterEach.
import base from './stryker.config.mjs';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  ...base,
  vitest: { configFile: 'vitest.integration.config.js' },
  mutate: ['src/resources/cuotas/services/findPrecioVigente.service.js'],
  htmlReporter: { fileName: 'reports/mutation/integration.html' },
  jsonReporter: { fileName: 'reports/mutation/integration.json' },
  concurrency: 1,
  timeoutMS: 30000,
};
