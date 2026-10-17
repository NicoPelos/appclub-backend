import cron from 'node-cron';
import MercadoPagoConfig from '../resources/pagos/models/MercadoPagoConfig.js';
import { reconciliarPagosMercadoPagoClub } from '../resources/pagos/services/reconciliarPagosMercadoPago.service.js';
import { notifyJobFailure } from '../services/pushNotification.service.js';

export const reconciliarPagosMercadoPago = async () => {
  console.log('💳 Reconciliación Mercado Pago: revisando intents pendientes...');
  const configs = await MercadoPagoConfig.find({ active: true });

  let total = 0;
  let totalExpirados = 0;
  for (const config of configs) {
    try {
      const { resueltos, errores, expirados } = await reconciliarPagosMercadoPagoClub({ clubId: config.clubId, accessToken: config.accessToken });
      total += resueltos;
      totalExpirados += expirados;
      if (errores) {
        console.error(`⚠️ Reconciliación Mercado Pago [${config.clubId}]: ${errores} intent(s) fallaron y se saltearon (ver logs arriba)`);
      }
    } catch (err) {
      console.error(`❌ Reconciliación Mercado Pago [${config.clubId}]: error revisando:`, err.message);
      await notifyJobFailure(config.clubId, 'Reconciliación Mercado Pago', err.message);
    }
  }

  console.log(`💳 Reconciliación Mercado Pago: ${total} pagos resueltos por polling, ${totalExpirados} intents expirados`);
};

export const startReconciliarPagosMercadoPagoJob = () => {
  cron.schedule('*/30 * * * *', async () => {
    try {
      await reconciliarPagosMercadoPago();
    } catch (err) {
      console.error('❌ Error en reconciliación de Mercado Pago:', err.message);
    }
  });

  console.log('💳 Reconciliación de pagos Mercado Pago job iniciado (cada 30 min)');
};
