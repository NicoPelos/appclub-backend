import Club from '../resources/clubs/models/Club.js';

// Mismo patrón de cache con TTL que permisosCache.js — protect corre en
// cada request autenticado, así que no conviene pagar una query a Club en
// cada uno solo para chequear si sigue activo (appcarc-backend#169).
const TTL_MS = 5 * 60 * 1000; // 5 minutos

// cache: Map<slug, { active: boolean, expiresAt: number }>
const cache = new Map();

async function cargarClub(slug) {
  const club = await Club.findOne({ slug }).select('active').lean();
  // Si no existe un Club para ese slug (datos legacy/tests que nunca crearon
  // uno), no bloquear accesos que ya funcionaban — el aislamiento acá es
  // "no dejar operar a un club marcado inactivo", no "exigir que exista".
  const active = club ? club.active !== false : true;
  cache.set(slug, { active, expiresAt: Date.now() + TTL_MS });
  return active;
}

export async function esClubActivo(slug) {
  if (!slug) return true;
  const entry = cache.get(slug);
  if (entry && entry.expiresAt > Date.now()) return entry.active;
  return cargarClub(slug);
}

export function invalidarClubActivo(slug) {
  cache.delete(slug);
}
