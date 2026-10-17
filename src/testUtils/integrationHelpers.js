import jwt from 'jsonwebtoken';
import User from '../resources/usuarios/models/User.js';
import Socio from '../resources/socios/models/Socio.js';
import Etiqueta from '../resources/etiquetas/models/Etiqueta.js';
import Precios from '../resources/cuotas/models/Precios.js';
import Suscripcion from '../resources/suscripciones/models/Suscripcion.js';
import Plan from '../resources/planes/models/Plan.js';
import Rol from '../resources/roles/models/Rol.js';
import { generarSlugUnico } from '../resources/roles/services/slug.service.js';

export const CLUB_ID = 'CARC';

let counter = 0;
const unique = (prefix) => `${prefix}-${Date.now()}-${counter++}`;

// Los tests de integración piden roles por nombre (ej. 'superadmin', 'socio')
// como hacía la API vieja. Como las colecciones se vacían después de cada
// test (ver testSetup.integration.js), no se puede cachear el Rol entre
// tests: se busca o se crea de cero cada vez.
export const getOrCreateRol = async ({ clubId, nombre }) => {
  let rol = await Rol.findOne({ clubId, nombre });
  if (!rol) {
    const slug = await generarSlugUnico({ clubId, nombre });
    rol = await Rol.create({ clubId, nombre, slug, permisos: [], active: true });
  }
  return rol;
};

export const createAdminUser = async (overrides = {}) => {
  const clubId = overrides.clubId || CLUB_ID;
  const nombresRoles = overrides.roles || ['superadmin'];
  const roles = await Promise.all(nombresRoles.map((nombre) => getOrCreateRol({ clubId, nombre })));

  const user = await User.create({
    email: overrides.email || `${unique('admin')}@carc.local`,
    password: 'hashed-not-used',
    roles: roles.map((r) => r._id),
    clubId,
    socioId: overrides.socioId || undefined,
  });
  const rolesSlugs = roles.map((r) => r.slug);
  const token = jwt.sign(
    { id: user._id, email: user.email, roles: rolesSlugs, clubId: user.clubId, socioId: user.socioId || null },
    process.env.JWT_SECRET,
    { expiresIn: '1h' },
  );
  return { user, token };
};

export const createSocio = async (overrides = {}) => Socio.create({
  apellido: overrides.apellido || 'Perez',
  nombre: overrides.nombre || 'Juan',
  dni: overrides.dni || unique('dni'),
  clubId: overrides.clubId || CLUB_ID,
  estado: overrides.estado || 'Activo',
  createdBy: 'test',
  updatedBy: 'test',
  ...overrides,
});

export const createEtiqueta = async (overrides = {}) => Etiqueta.create({
  clubId: overrides.clubId || CLUB_ID,
  nombre: overrides.nombre || 'Cuota Social',
  unidad: overrides.unidad || 'mes',
  uso_sistema: overrides.uso_sistema ?? 'cuota_social',
  createdBy: 'test',
  updatedBy: 'test',
  ...overrides,
});

export const createPrecio = async (overrides = {}) => Precios.create({
  clubId: overrides.clubId || CLUB_ID,
  etiquetaId: overrides.etiquetaId,
  nombre: overrides.nombre || 'Cuota Social',
  unidad: overrides.unidad || 'mes',
  monto: overrides.monto ?? 5000,
  vigenteDesde: overrides.vigenteDesde || new Date('2020-01-01'),
  vigenteHasta: overrides.vigenteHasta ?? null,
  createdBy: 'test',
  updatedBy: 'test',
  ...overrides,
});

export const createPlan = async (overrides = {}) => Plan.create({
  clubId: overrides.clubId || CLUB_ID,
  nombre: overrides.nombre || unique('plan'),
  tipo: overrides.tipo || 'social',
  modalidad: overrides.modalidad || 'mensual',
  etiquetaId: overrides.etiquetaId,
  createdBy: 'test',
  updatedBy: 'test',
  ...overrides,
});

export const createSuscripcion = async (overrides = {}) => Suscripcion.create({
  clubId: overrides.clubId || CLUB_ID,
  socioId: overrides.socioId,
  etiquetaId: overrides.etiquetaId,
  fechaDesde: overrides.fechaDesde || '2024-01',
  fechaHasta: overrides.fechaHasta ?? null,
  createdBy: 'test',
  updatedBy: 'test',
  ...overrides,
});
