import Rol from '../resources/roles/models/Rol.js';

const TTL_MS = 5 * 60 * 1000; // 5 minutos

// cache: Map<clubId, { permisosPorRol: Map<slug, Set<permiso>>, expiresAt: number }>
const cache = new Map();

async function cargarClub(clubId) {
  const roles = await Rol.find({ clubId, active: true }).lean();
  const permisosPorRol = new Map();
  for (const rol of roles) {
    permisosPorRol.set(rol.slug, new Set(rol.permisos));
  }
  cache.set(clubId, { permisosPorRol, expiresAt: Date.now() + TTL_MS });
  return permisosPorRol;
}

async function getPermisosPorRol(clubId) {
  const entry = cache.get(clubId);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.permisosPorRol;
  }
  return cargarClub(clubId);
}

export async function tienePermiso(clubId, rolesUsuario, permiso) {
  const permisosPorRol = await getPermisosPorRol(clubId);
  return rolesUsuario.some(rol => permisosPorRol.get(rol)?.has(permiso));
}

export async function getPermisosUsuario(clubId, rolesUsuario) {
  const permisosPorRol = await getPermisosPorRol(clubId);
  const permisos = new Set();
  for (const rol of rolesUsuario) {
    permisosPorRol.get(rol)?.forEach(p => permisos.add(p));
  }
  return [...permisos].sort();
}

export function invalidarClub(clubId) {
  cache.delete(clubId);
}
