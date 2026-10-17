import cron from 'node-cron';
import { syncFaaFeed } from '../resources/novedades/services/syncFaaFeed.service.js';

export const startFaaSyncJob = () => {
  // Corre cada 2 horas — el feed de FAA se actualiza con poca frecuencia,
  // no hace falta el mismo intervalo que Instagram. Minuto 10 (no en punto)
  // para no pisar alertaPrecios (8:00 diario) ni el sync mensual de
  // Instagram (4:00 el 1 y 15).
  cron.schedule('10 */2 * * *', async () => {
    try {
      const result = await syncFaaFeed();
      if (result.inserted > 0) {
        console.log(`📰 Sync FAA: ${result.inserted} novedades nuevas (${result.skipped} ya existían)`);
      }
    } catch (error) {
      console.error('❌ Error en sync de FAA:', error.message);
    }
  });

  console.log('📰 Sync de novedades de FAA iniciado (cada 2 horas)');
};

export default startFaaSyncJob;
