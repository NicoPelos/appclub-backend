import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import Rol from '../src/resources/roles/models/Rol.js';
import { PERMISOS, TODOS_LOS_PERMISOS } from '../src/constants/permisos.js';
import { generarSlugUnico } from '../src/resources/roles/services/slug.service.js';

await mongoose.connect(process.env.MONGO_URI);
console.log('✅ MongoDB conectado');

// Obtener clubId de CARC desde la BD (primer Rol admin/secretaria existente,
// o si no hay ninguno, el primer usuario activo).
import User from '../src/resources/usuarios/models/User.js';
const rolExistente = await Rol.findOne({ nombre: { $in: ['admin', 'secretaria'] } }).lean();
const clubId = rolExistente?.clubId ?? (await User.findOne({ active: true }).lean())?.clubId;
if (!clubId) {
  console.error('❌ No se encontró ningún rol ni usuario. Especificá el clubId manualmente.');
  process.exit(1);
}
console.log(`📋 Club: ${clubId}`);

const P = PERMISOS;

const ROLES_SEED = [
  {
    nombre: 'admin',
    permisos: TODOS_LOS_PERMISOS,
  },
  {
    nombre: 'autoridad',
    permisos: [
      P.SOCIOS_READ,
      P.COBROS_READ,
      P.MOVIMIENTOS_READ,
      P.ESCUELITA_READ,
      P.MURO_LIBRE_READ,
      P.HORARIOS_READ, P.HORARIOS_DEUDA,
      P.ETIQUETAS_READ,
      P.PRECIOS_READ,
      P.PLANES_READ,
      P.SUSCRIPCIONES_READ,
      P.EXPORT_SHEETS,
      P.AUDIT_READ,
      P.ASISTENCIAS_READ,
      P.EVENTOS_READ,
    ],
  },
  {
    nombre: 'secretaria',
    permisos: [
      P.SOCIOS_READ, P.SOCIOS_CREATE, P.SOCIOS_WRITE, P.SOCIOS_RESTORE,
      P.COBROS_READ, P.COBROS_WRITE, P.COBROS_DELETE, P.COBROS_PRECIO_HISTORICO,
      P.MOVIMIENTOS_READ, P.MOVIMIENTOS_WRITE, P.MOVIMIENTOS_DELETE,
      P.EVENTOS_READ, P.EVENTOS_WRITE, P.EVENTOS_DELETE,
      P.ESCUELITA_READ, P.ESCUELITA_WRITE, P.ESCUELITA_DELETE, P.ESCUELITA_CHECKIN,
      P.MURO_LIBRE_READ, P.MURO_LIBRE_WRITE, P.MURO_LIBRE_DELETE, P.MURO_LIBRE_CHECKIN,
      P.HORARIOS_READ, P.HORARIOS_WRITE, P.HORARIOS_DELETE, P.HORARIOS_DEUDA,
      P.ETIQUETAS_READ, P.ETIQUETAS_WRITE, P.ETIQUETAS_DELETE,
      P.PRECIOS_READ,
      P.PLANES_READ, P.PLANES_WRITE, P.PLANES_DELETE,
      P.SUSCRIPCIONES_READ, P.SUSCRIPCIONES_WRITE, P.SUSCRIPCIONES_CLOSE, P.SUSCRIPCIONES_DELETE,
      P.ASISTENCIAS_READ, P.ASISTENCIAS_WRITE,
      P.ADVERTENCIAS_READ,
      P.NOVEDADES_WRITE,
      P.USUARIOS_WRITE,
      P.ROLES_READ,
      P.RECURSOS_READ, P.RECURSOS_WRITE, P.RECURSOS_DELETE,
      P.INVENTARIO_READ, P.INVENTARIO_WRITE, P.INVENTARIO_DELETE,
    ],
  },
  {
    nombre: 'profesor',
    permisos: [
      P.SOCIOS_READ,
      P.ESCUELITA_READ, P.ESCUELITA_WRITE, P.ESCUELITA_DELETE, P.ESCUELITA_CHECKIN,
      P.PLANES_READ,
      P.ETIQUETAS_READ, P.PRECIOS_READ,
      P.HORARIOS_READ, P.HORARIOS_WRITE, P.HORARIOS_DELETE,
      P.ASISTENCIAS_READ, P.ASISTENCIAS_WRITE,
    ],
  },
  {
    nombre: 'palestrero',
    permisos: [
      P.SOCIOS_READ,
      P.MURO_LIBRE_READ, P.MURO_LIBRE_WRITE, P.MURO_LIBRE_DELETE, P.MURO_LIBRE_CHECKIN,
      P.HORARIOS_READ, P.HORARIOS_WRITE, P.HORARIOS_DELETE,
      P.ETIQUETAS_READ, P.PRECIOS_READ,
    ],
  },
  {
    nombre: 'limpieza',
    permisos: [
      P.HORARIOS_READ, P.HORARIOS_WRITE, P.HORARIOS_DELETE,
    ],
  },
  {
    nombre: 'arreglos',
    permisos: [
      P.HORARIOS_READ, P.HORARIOS_WRITE, P.HORARIOS_DELETE,
    ],
  },
  {
    nombre: 'colaborador',
    permisos: [
      P.SOCIOS_READ,
      P.ESCUELITA_READ, P.ESCUELITA_CHECKIN,
      P.MURO_LIBRE_READ, P.MURO_LIBRE_WRITE, P.MURO_LIBRE_CHECKIN,
      P.HORARIOS_READ,
      P.ASISTENCIAS_READ, P.ASISTENCIAS_WRITE,
    ],
  },
  {
    nombre: 'socio',
    permisos: [
      P.MURO_LIBRE_READ, P.MURO_LIBRE_CHECKIN_PROPIO,
      P.ESCUELITA_CHECKIN_PROPIO,
      P.ASISTENCIAS_READ,
      P.JUEGO_JUGAR,
    ],
  },
];

let creados = 0;
let actualizados = 0;

for (const rol of ROLES_SEED) {
  const existente = await Rol.findOne({ clubId, nombre: rol.nombre });
  if (existente) {
    await Rol.updateOne({ _id: existente._id }, { $set: { permisos: rol.permisos, active: true } });
    actualizados++;
  } else {
    const slug = await generarSlugUnico({ clubId, nombre: rol.nombre });
    await Rol.create({ clubId, nombre: rol.nombre, slug, permisos: rol.permisos, active: true });
    creados++;
  }
}

console.log(`✅ Roles creados: ${creados} | Actualizados: ${actualizados}`);
await mongoose.disconnect();
