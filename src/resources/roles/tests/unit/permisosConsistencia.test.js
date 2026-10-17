import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PERMISOS, TODOS_LOS_PERMISOS } from '../../../../constants/permisos.js';

// Red de seguridad liviana para el problema descrito en issue #25: authorize()
// recibe un string cualquiera y no valida nada contra permisos.js — un typo
// en el nombre de la constante (PERMISOS.SCOIOS_WRTE en vez de SOCIOS_WRITE)
// deja el endpoint accesible solo para superadmin, en silencio, sin romper
// nada en el momento.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, '../../../../..', 'src');
const RESOURCES_DIR = path.join(SRC_DIR, 'resources');

// Junta todos los archivos de rutas bajo src/resources — no siempre se llaman
// "routes.js" a secas (ej. cuotas/preciosRoutes.js, usuarios/staffRoutes.js),
// así que se busca cualquier *routes.js/*Routes.js recursivamente en vez de
// asumir un nombre fijo.
const routesFiles = fs.readdirSync(RESOURCES_DIR, { recursive: true })
  .filter((p) => /routes\.js$/i.test(p))
  .map((p) => path.join(RESOURCES_DIR, p));

// Matchea authorize(PERMISOS.X), authorizeSelfSocioOr(PERMISOS.X),
// authorizeSelfSocioQueryOr(PERMISOS.X), authorizeSelfPadreQueryOr(PERMISOS.X)
// y authorizeSelfYVinculadosOr(PERMISOS.X) — las formas en que una ruta
// declara un único permiso requerido.
const AUTHORIZE_CALL_RE = /authorize(?:SelfSocioOr|SelfSocioQueryOr|SelfPadreQueryOr|SelfYVinculadosOr)?\(\s*PERMISOS\.([A-Z0-9_]+)/g;

// authorizeAny([PERMISOS.X, PERMISOS.Y]) — deja pasar con cualquiera de varios
// permisos (ver muroLibre:checkin_propio / escuelita:checkin_propio,
// appCARC-mobile#60). Se matchea el array completo y después cada PERMISOS.X
// suelto adentro, porque el regex de arriba solo captura un permiso por match.
const AUTHORIZE_ANY_CALL_RE = /authorizeAny\(\s*\[([^\]]+)\]/g;
const PERMISO_REF_RE = /PERMISOS\.([A-Z0-9_]+)/g;

// { permisoKey, permisoValue, archivo }[] — una entrada por cada uso real en
// una ruta (puede haber más de un uso del mismo permiso, se listan todos
// para que un fallo señale el archivo exacto a corregir).
const usosEnRutas = routesFiles.flatMap((archivo) => {
  const contenido = fs.readFileSync(archivo, 'utf8');
  const relativo = path.relative(SRC_DIR, archivo);
  const usos = [];
  for (const match of contenido.matchAll(AUTHORIZE_CALL_RE)) {
    const permisoKey = match[1];
    usos.push({ permisoKey, permisoValue: PERMISOS[permisoKey], archivo: relativo });
  }
  for (const arrayMatch of contenido.matchAll(AUTHORIZE_ANY_CALL_RE)) {
    for (const match of arrayMatch[1].matchAll(PERMISO_REF_RE)) {
      const permisoKey = match[1];
      usos.push({ permisoKey, permisoValue: PERMISOS[permisoKey], archivo: relativo });
    }
  }
  return usos;
});

describe('Consistencia de permisos entre rutas y permisos.js', () => {
  it('encontró al menos un routes.js para analizar (sanity check)', () => {
    expect(routesFiles.length).toBeGreaterThan(10);
  });

  it('encontró al menos un uso de authorize(...) para analizar (sanity check)', () => {
    expect(usosEnRutas.length).toBeGreaterThan(10);
  });

  it('nivel 1 — todo permiso usado en una ruta existe en PERMISOS (sin typos)', () => {
    const conTypo = usosEnRutas.filter((u) => u.permisoValue === undefined);
    const detalle = conTypo.map((u) => `PERMISOS.${u.permisoKey} en ${u.archivo} — no existe esa constante`);
    expect(detalle).toEqual([]);
  });

  it('nivel 2 — todo permiso declarado en PERMISOS se usa en alguna ruta (sin permisos muertos)', () => {
    const usados = new Set(usosEnRutas.map((u) => u.permisoValue));
    // Permisos que a propósito no protegen ninguna ruta del backend — son
    // flags de visibilidad puramente del cliente (ej. qué tarjetas mostrar en
    // el Home), sin dato propio del club detrás para proteger server-side.
    // RECURSOS_READ dejó de estar acá cuando el CRUD de recursos externos
    // (topos/senderos editables por club) sumó una ruta real (appCARC-mobile#16).
    const SOLO_CLIENTE = new Set([]);
    const sinUsar = TODOS_LOS_PERMISOS.filter((p) => !usados.has(p) && !SOLO_CLIENTE.has(p));
    // No es un riesgo de seguridad (ver issue #25) — si esto falla, probablemente
    // sea un permiso agregado de más, o una ruta que debería usarlo y no lo hace.
    expect(sinUsar).toEqual([]);
  });

  it('nivel 3 — todo permiso usado en una ruta está asignado a algún rol por defecto (sin endpoints fantasma)', async () => {
    // Los roles por defecto del club viven en scripts/seed-roles.js, que no se
    // puede importar tal cual (corre top-level contra Mongo al importarse) —
    // se lee y evalúa el array ROLES_SEED de forma aislada.
    const seedPath = path.resolve(SRC_DIR, '..', 'scripts', 'seed-roles.js');
    const seedSrc = fs.readFileSync(seedPath, 'utf8');
    const inicio = seedSrc.indexOf('const ROLES_SEED');
    const fin = seedSrc.indexOf('\n];', inicio) + 3;
    const bloqueRoles = seedSrc.slice(inicio, fin);

    // eslint-disable-next-line no-new-func
    const ROLES_SEED = new Function('PERMISOS', 'TODOS_LOS_PERMISOS', `
      const P = PERMISOS;
      ${bloqueRoles}
      return ROLES_SEED;
    `)(PERMISOS, TODOS_LOS_PERMISOS);

    // El rol 'admin' tiene TODOS_LOS_PERMISOS por diseño — incluirlo en la
    // unión haría que este chequeo nunca detecte nada. Se lo excluye a
    // propósito: la pregunta real es "¿algún rol NO-admin puede llegar a usar
    // esto?", no "¿existe en algún lado?".
    const asignadosFueraDeAdmin = new Set(
      ROLES_SEED.filter((r) => r.nombre !== 'admin').flatMap((r) => r.permisos),
    );

    const permisosUsados = [...new Set(usosEnRutas.map((u) => u.permisoValue))];
    const fantasma = permisosUsados.filter((p) => p !== undefined && !asignadosFueraDeAdmin.has(p));

    // Excepciones conocidas al momento de escribir este test (2026-08-11,
    // issue #25) — ningún rol por defecto además de admin puede usar estos
    // endpoints. Puede ser intencional (ej. roles:write/delete y audit:revert
    // parecen restringidos a admin a propósito) o un olvido real (ej.
    // socios:create/delete, raro que secretaria tenga read/write/restore pero
    // no create/delete) — sin decidirlo caso por caso todavía, se documentan
    // acá en vez de dejar el test en rojo. Sacar de esta lista a medida que
    // se decida asignarlos a algún rol.
    // advertencias:read salió de acá el 2026-10-01: secretaria lo tiene por
    // defecto ahora (pedido explícito del usuario).
    const EXCEPCIONES_CONOCIDAS = new Set([
      'audit:revert',
      'precios:write',
      'precios:delete',
      'roles:write',
      'roles:delete',
      'socios:create',
      'socios:delete',
    ]);
    const fantasmaNuevo = fantasma.filter((p) => !EXCEPCIONES_CONOCIDAS.has(p));

    // Guardarraíl solo para roles por defecto (ver nota del issue #25): con
    // roles custom por club (appcarc-superadmin#5) un permiso "fantasma" acá
    // podría estar en uso real por un rol custom de algún club puntual.
    expect(fantasmaNuevo).toEqual([]);
  });
});
