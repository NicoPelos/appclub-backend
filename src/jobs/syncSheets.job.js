import cron from 'node-cron';
import { exportToSheets } from '../services/sheetsExport.service.js';
import Club from '../resources/clubs/models/Club.js';
import { notifyJobFailure } from '../services/pushNotification.service.js';

const syncClub = async (club) => {
  const result = await exportToSheets({
    clubId: club.slug,
    clubName: club.nombre,
    spreadsheetId: club.integraciones?.sheets?.spreadsheetId,
  });

  if (club.integraciones?.sheets?.spreadsheetId !== result.spreadsheetId) {
    club.integraciones.sheets.spreadsheetId = result.spreadsheetId;
    await club.save();
  }

  console.log(`✅ syncSheets [${club.slug}]: exportación completada → ${result.url}`);
  console.log(`   Socios: ${result.stats.socios} | Cobros: ${result.stats.cobros} | Horarios: ${result.stats.horarios}`);
};

export const startSyncSheetsJob = () => {
  // Todos los días a las 3am
  cron.schedule('0 3 * * *', async () => {
    console.log('🔄 syncSheets: iniciando exportación a Google Sheets...');
    const clubs = await Club.find({ active: true, 'modulos.exportSheets': true });
    for (const club of clubs) {
      try {
        await syncClub(club);
      } catch (err) {
        console.error(`❌ syncSheets [${club.slug}]: error en exportación:`, err.message);
        await notifyJobFailure(club.slug, 'Exportación a Google Sheets', err.message);
      }
    }
  });

  console.log('📅 syncSheets: job programado (todos los días a las 3am)');
};
