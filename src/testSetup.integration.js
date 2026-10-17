import mongoose from 'mongoose';
import { beforeAll, afterEach } from 'vitest';

process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/appcarc_test?replicaSet=rs0';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
process.env.DEFAULT_CLUB_ID = process.env.DEFAULT_CLUB_ID || 'CARC';
process.env.FORMS_WEBHOOK_SECRET = process.env.FORMS_WEBHOOK_SECRET || 'test_forms_webhook_secret';

// Bloquear integraciones externas reales durante los tests: varios handlers
// (ej. createSocioHandler) llaman a Google Sheets con las credenciales de
// producción del .env. Sin esto, un test que crea un socio vía la API termina
// escribiendo filas de prueba en la planilla real del club.
process.env.GOOGLE_SHEETS_SOCIOS_ID = '';
process.env.GOOGLE_SHEET_EXPORT_ID = '';

// Una sola conexión persiste durante toda la corrida (mongoose.connect es
// idempotente si ya está conectado): desconectar/reconectar entre archivos
// de test genera churn de sockets contra el puerto publicado en Docker y
// produce errores de red intermitentes.
beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI);
  }
  await Promise.all(Object.values(mongoose.connection.models).map((m) => m.init()));
});

afterEach(async () => {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
});
