import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import { resetDemoClub, DEMO_CREDENTIALS } from '../src/services/demoSeed.service.js';

await mongoose.connect(process.env.MONGO_URI);
console.log('✅ MongoDB conectado');

const result = await resetDemoClub();

console.log(`\n✅ Club demo reseteado: ${result.socios} socios ficticios.`);
console.log('\nCredenciales:');
for (const [rol, { email, password }] of Object.entries(DEMO_CREDENTIALS)) {
  console.log(`  ${rol.padEnd(11)}: ${email} / ${password}`);
}

await mongoose.disconnect();
