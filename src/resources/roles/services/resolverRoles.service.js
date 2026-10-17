import Rol from '../models/Rol.js';

// User.roles guarda ObjectIds (ver appcarc-backend#24). Estas funciones son el
// único punto donde se traduce entre esa identidad real y las dos formas en
// que el rol aparece "de afuera":
//   - nombre: lo que tipea un humano en un formulario (superadmin Users.jsx,
//     el endpoint legacy /api/auth/register).
//   - slug: la identidad estable que usa el código para roles conocidos de
//     antemano (JWT, notifyRoles, ROLES_STAFF, seeds) — sobrevive a un
//     renombre del rol, a diferencia de nombre.

// nombres tipeados por un humano -> ObjectIds de Rol del club. Los que no
// matchean ningún Rol existente se descartan en silencio (igual que antes,
// cuando un nombre de rol inválido en el array simplemente no otorgaba
// ningún permiso).
export async function obtenerRolIdsPorNombres({ clubId, nombres }) {
  if (!nombres?.length) return [];
  const roles = await Rol.find({ clubId, nombre: { $in: nombres }, active: true }).select('_id').lean();
  return roles.map((r) => r._id);
}

// slugs conocidos por el código -> ObjectIds de Rol del club.
export async function obtenerRolIdsPorSlugs({ clubId, slugs }) {
  if (!slugs?.length) return [];
  const roles = await Rol.find({ clubId, slug: { $in: slugs }, active: true }).select('_id').lean();
  return roles.map((r) => r._id);
}

// ObjectIds de Rol -> slugs. Así se arma el array "roles" del JWT/response de
// login, para que el código que compara contra literales (ej. 'superadmin',
// 'socio') siga funcionando sin cambios aunque el rol se renombre.
// clubId es obligatorio (appcarc-backend#162): era el único punto del módulo
// que no lo exigía, rompiendo el mismo invariante multi-tenant que sí
// respetan obtenerRolIdsPorNombres/obtenerRolIdsPorSlugs — sin esto, un
// ObjectId de Rol de otro club colado en user.roles (por una migración, un
// bug de asignación, etc.) se resolvería en silencio a un slug real de ese
// otro club.
export async function obtenerSlugsPorRolIds({ clubId, rolIds }) {
  if (!rolIds?.length) return [];
  const roles = await Rol.find({ _id: { $in: rolIds }, clubId, active: true }).select('slug').lean();
  return roles.map((r) => r.slug);
}
