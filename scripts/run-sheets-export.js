import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

// Pre-register models needed for populate chains
import '../src/resources/planes/models/Plan.js';
import '../src/resources/socios/models/Socio.js';
import '../src/resources/asistencias/models/Asistencia.js';

import { exportToSheets } from '../src/services/sheetsExport.service.js';
import Club from '../src/resources/clubs/models/Club.js';

const clubSlug = process.env.DEFAULT_CLUB_ID || 'CARC';

await mongoose.connect(process.env.MONGO_URI);
console.log('✅ MongoDB conectado');

// Club.slug tiene lowercase:true en el schema; algunos clubs (ej. CARC) tienen
// el slug guardado en mayúsculas de antes de ese constraint, así que un
// findOne({slug}) normal nunca matchea (Mongoose castea la query a minúsculas).
const club = await Club.findOne({ slug: new RegExp(`^${clubSlug}$`, 'i') });
if (!club) throw new Error(`Club "${clubSlug}" no encontrado`);

const result = await exportToSheets({
  clubId: club.slug,
  clubName: club.nombre,
  spreadsheetId: club.integraciones?.sheets?.spreadsheetId,
});
console.log('✅ Export completado');
console.log('   URL:', result.url);
console.log('   Stats:', JSON.stringify(result.stats, null, 2));

await mongoose.disconnect();
