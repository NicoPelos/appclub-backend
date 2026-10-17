import cron from 'node-cron';
import { syncInstagramFeed } from '../resources/novedades/services/syncInstagram.service.js';
import { refreshInstagramToken } from '../resources/novedades/services/refreshInstagramToken.service.js';
import { notifyClub } from '../services/pushNotification.service.js';
import InstagramConfig from '../resources/novedades/models/InstagramConfig.js';

export const startInstagramSyncJob = () => {
  // Corre cada 30 minutos, para cada club que tenga Instagram configurado.
  // Corrido 15 min respecto de reconciliarPagosMercadoPago (también */30)
  // para que no compitan por CPU al mismo tiempo.
  cron.schedule('15,45 * * * *', async () => {
    const clubIds = await InstagramConfig.distinct('clubId');
    for (const clubId of clubIds) {
      try {
        const result = await syncInstagramFeed({ clubId });
        if (result.inserted > 0) {
          console.log(`📸 Instagram sync [${clubId}]: ${result.inserted} novedades nuevas (${result.skipped} ya existían)`);
          notifyClub(clubId, {
            title: '📸 Novedad del club',
            body: `Hay ${result.inserted} publicación${result.inserted > 1 ? 'es' : ''} nueva${result.inserted > 1 ? 's' : ''} en Instagram`,
            data: { tipo: 'instagram_sync', url: 'carc://(tabs)/comunidad' },
          }).catch((err) => console.error(`Error enviando push de Instagram sync [${clubId}]:`, err));
        }
      } catch (error) {
        console.error(`❌ Error en sync de Instagram [${clubId}]:`, error.message);
      }
    }
  });

  // Refresca el token de acceso los días 1 y 15 de cada mes a las 4am.
  // Dura 60 días y se puede refrescar en cualquier momento después de las
  // primeras 24hs, así que esta frecuencia deja margen de sobra.
  cron.schedule('0 4 1,15 * *', async () => {
    const clubIds = await InstagramConfig.distinct('clubId');
    for (const clubId of clubIds) {
      try {
        await refreshInstagramToken(clubId);
        console.log(`🔑 Token de Instagram refrescado correctamente [${clubId}]`);
      } catch (error) {
        console.error(`❌ Error refrescando token de Instagram [${clubId}]:`, error.message);
      }
    }
  });

  console.log('📸 Instagram sync job iniciado (cada 30 minutos)');
};
