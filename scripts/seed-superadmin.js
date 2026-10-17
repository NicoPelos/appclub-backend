import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

import User from '../src/resources/usuarios/models/User.js';
import Rol from '../src/resources/roles/models/Rol.js';
import { generarSlugUnico } from '../src/resources/roles/services/slug.service.js';
import { TODOS_LOS_PERMISOS } from '../src/constants/permisos.js';

await mongoose.connect(process.env.MONGO_URI);
console.log('✅ MongoDB conectado');

const email    = process.env.SUPERADMIN_EMAIL;
const password = process.env.SUPERADMIN_PASSWORD;

if (!email || !password) {
  console.error('❌ Faltan SUPERADMIN_EMAIL o SUPERADMIN_PASSWORD en .env');
  process.exit(1);
}

const existe = await User.findOne({ email, clubId: 'SUPER' });
if (existe) {
  console.log(`ℹ️  Superadmin '${email}' ya existe — sin cambios`);
  await mongoose.disconnect();
  process.exit(0);
}

// 'superadmin' no es un rol de club normal: es el bypass total de
// authorize()/protectSuper (ver appcarc-backend#24). Vive bajo un clubId
// especial 'SUPER' que no corresponde a ningún club real.
let rolSuperadmin = await Rol.findOne({ clubId: 'SUPER', nombre: 'superadmin' });
if (!rolSuperadmin) {
  const slug = await generarSlugUnico({ clubId: 'SUPER', nombre: 'superadmin' });
  rolSuperadmin = await Rol.create({ clubId: 'SUPER', nombre: 'superadmin', slug, permisos: TODOS_LOS_PERMISOS, active: true });
  console.log(`✅ Rol 'superadmin' creado (slug: ${slug})`);
}

const salt = await bcrypt.genSalt(10);
const hashed = await bcrypt.hash(password, salt);

await User.create({
  email,
  password: hashed,
  nombre: 'Superadmin',
  roles: [rolSuperadmin._id],
  clubId: 'SUPER',
  active: true,
});

console.log(`✅ Superadmin creado: ${email}`);
await mongoose.disconnect();
