import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import Club from '../src/resources/clubs/models/Club.js';

await mongoose.connect(process.env.MONGO_URI);
console.log('✅ MongoDB conectado');

const clubId = process.env.DEFAULT_CLUB_ID || 'CARC';

const existe = await Club.findOne({ slug: clubId.toLowerCase() });
if (existe) {
  console.log(`ℹ️  Club '${clubId}' ya existe — sin cambios`);
  await mongoose.disconnect();
  process.exit(0);
}

await Club.create({
  nombre: process.env.CLUB_NAME || clubId,
  slug: clubId.toLowerCase(),
  plan: 'basico',
  modulos: { escuelita: true, muroLibre: true, exportSheets: true, novedades: true },
  active: true,
});

console.log(`✅ Club '${clubId}' creado`);
await mongoose.disconnect();
