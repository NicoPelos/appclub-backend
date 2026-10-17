import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import User from '../src/resources/usuarios/models/User.js';
import Rol from '../src/resources/roles/models/Rol.js';
import { generarSlugUnico } from '../src/resources/roles/services/slug.service.js';
import { TODOS_LOS_PERMISOS } from '../src/constants/permisos.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';
const ADMIN_NOMBRE = process.env.ADMIN_NOMBRE || 'Admin';
const DEFAULT_CLUB_ID = process.env.DEFAULT_CLUB_ID || 'club-default';

if (!MONGO_URI) {
  console.error('Falta la variable MONGO_URI en .env');
  process.exit(1);
}

const run = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    const existingAdmin = await User.findOne({ email: ADMIN_EMAIL });
    if (existingAdmin) {
      console.log('El admin ya existe:', ADMIN_EMAIL);
      process.exit(0);
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, salt);

    let rolAdmin = await Rol.findOne({ clubId: DEFAULT_CLUB_ID, nombre: 'admin' });
    if (!rolAdmin) {
      const slug = await generarSlugUnico({ clubId: DEFAULT_CLUB_ID, nombre: 'admin' });
      rolAdmin = await Rol.create({ clubId: DEFAULT_CLUB_ID, nombre: 'admin', slug, permisos: TODOS_LOS_PERMISOS, active: true });
      console.log(`✅ Rol 'admin' creado para club ${DEFAULT_CLUB_ID} (slug: ${slug})`);
    }

    const adminUser = new User({
      email: ADMIN_EMAIL,
      password: hashedPassword,
      nombre: ADMIN_NOMBRE,
      roles: [rolAdmin._id],
      clubId: DEFAULT_CLUB_ID,
      active: true,
    });

    await adminUser.save();
    console.log('Admin creado:', ADMIN_EMAIL);
    process.exit(0);
  } catch (error) {
    console.error('Error creando admin:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
};

run();
