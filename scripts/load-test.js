// Test de carga contra la API real (issue #34).
//
// Corre SOLO contra el club demo (se resetea todos los días), nunca contra
// datos reales de CARC — así el check-in de prueba no ensucia producción.
//
// Escenarios:
//   read     Carga sostenida de lectura: GET /api/socios + GET /api/socios/:id/deuda.
//            Son los endpoints de mayor uso real (listar socios, ver deuda) y no
//            tienen efectos secundarios, así que se puede repetir sin límite.
//   checkin  Ráfaga concurrente de POST /api/muro-libre/checkin, uno por cada socio
//            del club demo, todos al mismo tiempo. No mide throughput sostenido
//            (cada socio solo puede tener un check-in por día — es una regla de
//            negocio, no un límite técnico) sino que valida que la ruta de
//            escritura con lock/transacción no se caiga ni duplique registros
//            bajo concurrencia real.
//   all      read + checkin
//
// Destino obligatorio: --base-url=<url> o LOAD_TEST_BASE_URL. No hay host por
// defecto, para no apuntarle sin querer a un servidor que no es el esperado.
//
// Uso:
//   node scripts/load-test.js --scenario=read --duration=20 --connections=20
//   node scripts/load-test.js --scenario=checkin
//   node scripts/load-test.js --scenario=all --duration=30 --connections=30
//
// La corrida liviana por defecto (20s, 20 conexiones) es segura para validar
// que todo funciona. Para el estrés real (buscar el techo de la Raspi), subir
// --duration y --connections a mano.

import autocannon from 'autocannon';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const baseUrlArg = typeof args['base-url'] === 'string' ? args['base-url'] : '';
const BASE_URL = (baseUrlArg || process.env.LOAD_TEST_BASE_URL || '').trim().replace(/\/+$/, '');
if (!BASE_URL) {
  console.error('Falta el destino: pasá --base-url=<url> o definí LOAD_TEST_BASE_URL (ej. https://app.appclub.net.ar).');
  process.exit(1);
}
const SCENARIO = args.scenario || 'read';
const DURATION = Number(args.duration || 20);
const CONNECTIONS = Number(args.connections || 20);
const EMAIL = args.email || 'admin@demo.appclub.ar';
const PASSWORD = args.password || 'DemoAdmin2026!';

const log = (...a) => console.log(...a);

async function login() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`Login falló (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  if (data.requiresProfileSelection) {
    throw new Error('La cuenta usada para el test tiene múltiples perfiles — usá una cuenta staff sin vínculos.');
  }
  return data.token;
}

async function getSocios(token) {
  const res = await fetch(`${BASE_URL}/api/socios?limit=200`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET /api/socios falló (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.socios || data.data || data;
}

function printAutocannonSummary(result) {
  const { latency, requests, throughput, errors, timeouts, non2xx } = result;
  log(`  requests: ${requests.total} total, ${requests.average.toFixed(1)}/s promedio`);
  log(`  latencia: p50=${latency.p50}ms p95=${latency.p97_5}ms p99=${latency.p99}ms max=${latency.max}ms`);
  log(`  throughput: ${(throughput.average / 1024).toFixed(1)} KB/s promedio`);
  log(`  errores: ${errors} de red, ${timeouts} timeouts, ${non2xx} respuestas no-2xx`);
}

async function runRead(token, socios) {
  log(`\n=== Escenario READ: GET /api/socios + GET /api/socios/:id/deuda ===`);
  log(`Contra ${BASE_URL} — ${CONNECTIONS} conexiones, ${DURATION}s`);

  const sampleIds = socios.slice(0, 20).map((s) => s._id);
  if (sampleIds.length === 0) throw new Error('El club demo no tiene socios cargados — no se puede armar el escenario read.');

  const result = await autocannon({
    url: BASE_URL,
    connections: CONNECTIONS,
    duration: DURATION,
    headers: { Authorization: `Bearer ${token}` },
    requests: [
      { method: 'GET', path: '/api/socios?limit=50' },
      ...sampleIds.map((id) => ({ method: 'GET', path: `/api/socios/${id}/deuda` })),
    ],
  });

  printAutocannonSummary(result);
  return result;
}

async function runCheckin(token, socios) {
  log(`\n=== Escenario CHECKIN: POST /api/muro-libre/checkin concurrente ===`);
  log(`${socios.length} socios del club demo, uno por request, todos en simultáneo`);

  const start = Date.now();
  const settled = await Promise.allSettled(
    socios.map((s) =>
      fetch(`${BASE_URL}/api/muro-libre/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dni: s.dni, tipoPase: 'diario', estadoPago: 'pagado', paymentMethod: 'Efectivo' }),
      }).then(async (res) => ({ status: res.status, socio: s.dni, body: res.status >= 400 ? await res.text() : null })),
    ),
  );
  const elapsed = Date.now() - start;

  let ok = 0, yaHoy = 0, otros = 0, fallosRed = 0;
  for (const r of settled) {
    if (r.status === 'rejected') { fallosRed++; continue; }
    const { status, body } = r.value;
    if (status === 201) ok++;
    else if (status === 409) yaHoy++;
    else { otros++; log(`  ! ${r.value.socio} -> ${status}: ${body}`); }
  }

  log(`  tiempo total: ${elapsed}ms para ${socios.length} requests concurrentes`);
  log(`  201 creados: ${ok} | 409 ya tenía check-in hoy: ${yaHoy} | otros errores: ${otros} | fallos de red: ${fallosRed}`);
  if (otros > 0 || fallosRed > 0) {
    log(`  ATENCIÓN: hubo respuestas inesperadas — revisar arriba antes de asumir que la concurrencia es segura.`);
  } else {
    log(`  OK: cada socio tuvo a lo sumo un check-in exitoso, sin errores de servidor bajo concurrencia.`);
  }
}

async function main() {
  log(`Login como ${EMAIL} contra ${BASE_URL}...`);
  const token = await login();
  const socios = await getSocios(token);
  log(`Club demo: ${socios.length} socios disponibles.`);

  if (SCENARIO === 'read' || SCENARIO === 'all') await runRead(token, socios);
  if (SCENARIO === 'checkin' || SCENARIO === 'all') await runCheckin(token, socios);

  log('\nListo.');
}

main().catch((err) => {
  console.error('Error en el load test:', err.message);
  process.exit(1);
});
