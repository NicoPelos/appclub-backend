// Mutation testing del piloto de #263 (cuotas). Se corre a mano, no en CI:
//   npx stryker run                       → los servicios de cuotas con los tests unitarios
//   npx stryker run -m <archivo>          → un solo servicio
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.js' },
  mutate: ['src/resources/cuotas/services/*.service.js'],
  coverageAnalysis: 'perTest',
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/unit.html' },
  jsonReporter: { fileName: 'reports/mutation/unit.json' },
  // Lo que no hace falta en el sandbox (data/mongo ni siquiera se puede leer)
  ignorePatterns: ['data', 'uploads', 'mkdocs-manual', 'docs', 'public', 'deploy', 'reports', '*.xlsx', '*.json', '!package.json', '!package-lock.json'],
  // El sandbox vive dentro del repo, así que resuelve node_modules subiendo de carpeta.
  // Con el symlink, Stryker recorre todo el árbol y choca con data/mongo (sin permiso de lectura).
  symlinkNodeModules: false,
  tempDirName: '.stryker-tmp',
  concurrency: 4,
};
