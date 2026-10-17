import cron from 'node-cron';
import { resetDemoClub } from '../services/demoSeed.service.js';
import { acquireJobLock, releaseJobLock } from './jobLock.service.js';

const LOCK_NAME = 'reset-demo';

export const ejecutarResetDemo = async () => {
  // Candado por si el contenedor viejo y el nuevo de un redeploy conviven un
  // momento y ambos tienen este cron programado — dos resets en simultáneo
  // pisándose entre sí causaban un duplicate key (appcarc-backend#26).
  const gotLock = await acquireJobLock(LOCK_NAME);
  if (!gotLock) {
    console.log('🔄 Reset del club demo: ya hay otra ejecución en curso, se omite esta.');
    return;
  }
  try {
    const result = await resetDemoClub();
    console.log(`🔄 Club demo reseteado: ${result.socios} socios ficticios`);
  } catch (error) {
    console.error('❌ Error reseteando club demo:', error.message);
  } finally {
    await releaseJobLock(LOCK_NAME);
  }
};

export const startResetDemoJob = () => {
  // Corre todos los días a las 5am — el club demo es autoservicio público
  // (ver appcarc-backend#9), así que se resetea solo, sin intervención manual.
  cron.schedule('0 5 * * *', ejecutarResetDemo);

  console.log('🔄 Reset diario del club demo iniciado (todos los días a las 5am)');
};

export default startResetDemoJob;
