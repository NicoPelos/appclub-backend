import { syncInstagramFeed } from '../../novedades/services/syncInstagram.service.js';
import InstagramConfig from '../../novedades/models/InstagramConfig.js';
import { exportToSheets } from '../../../services/sheetsExport.service.js';
import { enviarRecordatorios } from '../../../jobs/recordatorioCuotas.job.js';
import Club from '../../clubs/models/Club.js';

// Corre una tarea por-club y junta resultados/errores individuales en vez de
// abortar todo el job si un solo club falla (ej. token de Instagram vencido).
const runPerClub = async (clubIds, task) => {
  const detalle = [];
  for (const clubId of clubIds) {
    try {
      detalle.push({ clubId, ok: true, ...(await task(clubId)) });
    } catch (error) {
      detalle.push({ clubId, ok: false, error: error.message });
    }
  }
  return { clubes: detalle.length, detalle };
};

export const JOBS = {
  syncSheets: async () => {
    const clubs = await Club.find({ active: true, 'modulos.exportSheets': true });
    return runPerClub(clubs.map((c) => c.slug), async (clubId) => {
      const club = clubs.find((c) => c.slug === clubId);
      const result = await exportToSheets({
        clubId,
        clubName: club.nombre,
        spreadsheetId: club.integraciones?.sheets?.spreadsheetId,
      });
      if (club.integraciones?.sheets?.spreadsheetId !== result.spreadsheetId) {
        club.integraciones.sheets.spreadsheetId = result.spreadsheetId;
        await club.save();
      }
      return { url: result.url, stats: result.stats };
    });
  },
  syncInstagram: async () => {
    const clubIds = await InstagramConfig.distinct('clubId');
    return runPerClub(clubIds, (clubId) => syncInstagramFeed({ clubId }));
  },
  recordatorioCuotas: async () => {
    await enviarRecordatorios();
    return { message: 'Recordatorios enviados' };
  },
};

export const runJobHandler = async (req, res) => {
  try {
    const { nombre } = req.params;

    // JOBS es un objeto literal, así que hereda de Object.prototype —
    // !JOBS[nombre] no distingue una key propia de una heredada ("constructor"
    // pasaba el chequeo y ejecutaba Object(), dando una falsa apariencia de
    // éxito; "hasOwnProperty"/"toString" pasaban también pero explotaban al
    // llamarse con el this equivocado, dando 500 en vez de 400)
    // (appcarc-backend#204).
    if (!Object.hasOwn(JOBS, nombre)) {
      return res.status(400).json({
        message: `Job '${nombre}' no existe`,
        disponibles: Object.keys(JOBS),
      });
    }

    console.log(`[super] Ejecutando job '${nombre}' manualmente...`);
    const result = await JOBS[nombre]();
    res.status(200).json({ job: nombre, result });
  } catch (error) {
    console.error(`[super] Error ejecutando job:`, error);
    res.status(500).json({ message: error.message });
  }
};
