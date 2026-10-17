/**
 * seed-planes.js
 *
 * Crea los Planes base a partir de:
 *   1. CategoriaEscuelita existentes (con su etiquetaId)
 *   2. Etiquetas de tipo 'mes' para social y muro libre
 *
 * Luego migra los alumnos activos de Escuelita a Suscripciones con planId.
 *
 * Idempotente: usa upsert por clubId+nombre.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import Plan from '../src/resources/planes/models/Plan.js';
import Suscripcion from '../src/resources/suscripciones/models/Suscripcion.js';
import CategoriaEscuelita from '../src/resources/escuelita/models/CategoriaEscuelita.js';
import Escuelita from '../src/resources/escuelita/models/Escuelita.js';
import Etiqueta from '../src/resources/etiquetas/models/Etiqueta.js';
import User from '../src/resources/usuarios/models/User.js';
import Rol from '../src/resources/roles/models/Rol.js';

await mongoose.connect(process.env.MONGO_URI);
console.log('✅ MongoDB conectado');

const rolAdmin = await Rol.findOne({ nombre: 'admin' }).lean();
if (!rolAdmin) {
  console.error('❌ No se encontró ningún rol admin.');
  process.exit(1);
}
const clubId = rolAdmin.clubId;
const adminUser = await User.findOne({ clubId, roles: rolAdmin._id }).lean();
const BY = adminUser?.email || 'seed-planes';
console.log(`📋 Club: ${clubId}\n`);

// ── 1. Planes de Escuelita desde CategoriaEscuelita ──────────────────────────

const categorias = await CategoriaEscuelita.find({ clubId, active: true }).lean();
console.log(`📂 Categorías escuelita encontradas: ${categorias.length}`);

const categoriaAPlan = {};

for (const cat of categorias) {
  if (!cat.etiquetaId) {
    console.warn(`  ⚠️  ${cat.nombre} (${cat.codigo}) sin etiquetaId — omitida`);
    continue;
  }

  const plan = await Plan.findOneAndUpdate(
    { clubId, nombre: cat.nombre },
    {
      $set: {
        clubId,
        nombre: cat.nombre,
        descripcion: cat.descripcion || '',
        tipo: 'escuelita',
        modalidad: 'mensual',
        etiquetaId: cat.etiquetaId,
        atributos: {
          frecuenciaSemanal: cat.frecuenciaSemanal,
          codigo: cat.codigo,
          categoriaEscuelitaId: cat._id,
        },
        active: true,
        createdBy: BY,
        updatedBy: BY,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  categoriaAPlan[cat._id.toString()] = plan._id;
  console.log(`  ✅ Plan escuelita: "${plan.nombre}" (freq: ${cat.frecuenciaSemanal}x/sem)`);
}

// ── 2. Plan Social ────────────────────────────────────────────────────────────

const etiquetaSocial = await Etiqueta.findOne({
  clubId,
  active: true,
  nombre: /cuota social/i,
  unidad: 'mes',
}).lean();

if (etiquetaSocial) {
  const planSocial = await Plan.findOneAndUpdate(
    { clubId, nombre: 'Socio Activo' },
    {
      $set: {
        clubId,
        nombre: 'Socio Activo',
        descripcion: 'Cuota mensual de socio activo',
        tipo: 'social',
        modalidad: 'mensual',
        etiquetaId: etiquetaSocial._id,
        atributos: {},
        active: true,
        createdBy: BY,
        updatedBy: BY,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  console.log(`\n  ✅ Plan social: "${planSocial.nombre}" → etiqueta "${etiquetaSocial.nombre}"`);
} else {
  console.warn('\n  ⚠️  No se encontró etiqueta "Cuota Social" (mes) — plan social omitido');
}

// ── 3. Planes Muro Libre ──────────────────────────────────────────────────────

const mappingMuro = [
  { patron: /muro libre mensual(?!.*no.?soci)/i, nombre: 'Muro Libre Mensual - Socio',    modalidad: 'mensual', requiereSocio: true },
  { patron: /muro libre mensual.*no.?soci/i,     nombre: 'Muro Libre Mensual - No Socio', modalidad: 'mensual', requiereSocio: false },
  { patron: /muro libre diario(?!.*no.?soci)/i,  nombre: 'Muro Libre Diario - Socio',     modalidad: 'por_uso', requiereSocio: true },
  { patron: /muro libre diario.*no.?soci/i,      nombre: 'Muro Libre Diario - No Socio',  modalidad: 'por_uso', requiereSocio: false },
];

const etiquetasMuro = await Etiqueta.find({ clubId, active: true, nombre: /muro libre/i }).lean();
console.log(`\n📂 Etiquetas muro libre encontradas: ${etiquetasMuro.length}`);

for (const { patron, nombre, modalidad, requiereSocio } of mappingMuro) {
  const etiqueta = etiquetasMuro.find(e => patron.test(e.nombre));
  if (!etiqueta) {
    console.warn(`  ⚠️  Sin etiqueta para "${nombre}" — omitido`);
    continue;
  }

  const plan = await Plan.findOneAndUpdate(
    { clubId, nombre },
    {
      $set: {
        clubId,
        nombre,
        descripcion: '',
        tipo: 'muro_libre',
        modalidad,
        etiquetaId: etiqueta._id,
        atributos: { requiereSocio },
        active: true,
        createdBy: BY,
        updatedBy: BY,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  console.log(`  ✅ Plan muro libre: "${plan.nombre}"`);
}

// ── 4. Migrar Escuelita activa → Suscripciones ───────────────────────────────

console.log('\n── Migrando alumnos Escuelita → Suscripciones ──');

const alumnos = await Escuelita.find({ clubId, active: true, estado: 'activo' })
  .populate('categoriaId')
  .lean();

console.log(`  Alumnos activos: ${alumnos.length}`);

let creadas = 0;
let saltadas = 0;

for (const alumno of alumnos) {
  const cat = alumno.categoriaId;
  if (!cat) {
    console.warn(`  ⚠️  Alumno ${alumno.socioId} sin categoría — omitido`);
    saltadas++;
    continue;
  }

  const planId = categoriaAPlan[cat._id.toString()];
  if (!planId) {
    console.warn(`  ⚠️  Sin plan para categoría "${cat.nombre}" — omitido`);
    saltadas++;
    continue;
  }

  // fechaDesde = mes de inscripción
  const d = new Date(alumno.fechaInscripcion);
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const fechaDesde = `${d.getFullYear()}-${mes}`;

  const existing = await Suscripcion.findOne({
    clubId,
    socioId: alumno.socioId,
    planId,
    active: true,
  });

  if (existing) {
    saltadas++;
    continue;
  }

  await Suscripcion.create({
    clubId,
    socioId: alumno.socioId,
    planId,
    etiquetaId: cat.etiquetaId,
    fechaDesde,
    fechaHasta: null,
    active: true,
    createdBy: BY,
    updatedBy: BY,
  });
  creadas++;
}

console.log(`  ✅ Suscripciones creadas: ${creadas} | Saltadas: ${saltadas}`);

// ── Resumen ───────────────────────────────────────────────────────────────────

const totalPlanes = await Plan.countDocuments({ clubId });
console.log(`\n✅ Seed completo. Planes en BD: ${totalPlanes}`);

await mongoose.disconnect();
