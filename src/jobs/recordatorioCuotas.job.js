import cron from 'node-cron';
import User from '../resources/usuarios/models/User.js';
import Escuelita from '../resources/escuelita/models/Escuelita.js';
import Socio from '../resources/socios/models/Socio.js';
import { filtroSociosVigentes } from '../resources/socios/services/sociosVigentes.service.js';
import { calcularDeuda } from '../resources/cuotas/services/calcularDeuda.service.js';
import { sendPushNotification, notifyJobFailure } from '../services/pushNotification.service.js';
import { periodoActualArgentino, TIMEZONE_ARGENTINA } from '../services/fechaArgentina.js';

const DEFAULT_CLUB_ID = process.env.DEFAULT_CLUB_ID || 'CARC';

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

// Mes en curso de Argentina, no del reloj del proceso (appcarc-backend#283).
const getMesActual = () => MESES[Number(periodoActualArgentino().slice(5, 7)) - 1];

const buildBody = (social, escuelita) => {
  const partes = [];
  if (social?.mesesDeuda > 0) {
    partes.push(`cuota social (${social.mesesDeuda} ${social.mesesDeuda === 1 ? 'mes' : 'meses'})`);
  }
  if (escuelita?.mesesDeuda > 0) {
    partes.push(`escuelita (${escuelita.mesesDeuda} ${escuelita.mesesDeuda === 1 ? 'mes' : 'meses'})`);
  }
  return `Tenés cuotas pendientes: ${partes.join(' y ')}. ¡No te olvides de ponerte al día!`;
};

// Se queda solo con los usuarios cuyo socio está vigente (Activo/Adherente)
// en su propio club — appcarc-backend#307: un socio en Baja con la app
// instalada no tiene que recibir el aviso. Una consulta por club en vez de
// una por usuario. Un socio inexistente, borrado o sin estado no aparece en
// la consulta, así que tampoco se le avisa: ante la duda, no se notifica.
const filtrarUsuariosConSocioVigente = async (users) => {
  const socioIdsPorClub = new Map();
  for (const user of users) {
    if (!socioIdsPorClub.has(user.clubId)) socioIdsPorClub.set(user.clubId, []);
    socioIdsPorClub.get(user.clubId).push(user.socioId);
  }

  const vigentes = new Set();
  for (const [clubId, socioIds] of socioIdsPorClub) {
    const socios = await Socio.find({ ...filtroSociosVigentes(clubId), _id: { $in: socioIds } })
      .select('_id')
      .lean();
    for (const socio of socios) vigentes.add(`${clubId}:${socio._id}`);
  }

  return users.filter((user) => vigentes.has(`${user.clubId}:${user.socioId}`));
};

export const enviarRecordatorios = async () => {
  console.log('📅 Recordatorio de cuotas: iniciando...');

  const users = await User.find({
    active: true,
    expoPushToken: { $ne: null },
    socioId: { $ne: null },
  }).select('socioId expoPushToken clubId').lean();

  const destinatarios = await filtrarUsuariosConSocioVigente(users);

  let notificados = 0;

  for (const user of destinatarios) {
    try {
      const deuda = await calcularDeuda({ socioId: user.socioId, clubId: user.clubId });
      const social = deuda.suscripciones.find((s) => s.etiqueta?.uso_sistema === 'cuota_social') ?? null;

      // BUG appcarc-backend#156 (mismo patrón que advertencias): la etiqueta
      // de cuota de escuelita depende del plan del socio (X1/X2, Adultos,
      // etc.) — no hay una única etiqueta global con uso_sistema
      // 'cuota_escuelita'. Se resuelve por la inscripción activa → plan →
      // etiquetaId, igual que en checkinEscuelita.handler.js.
      const alumno = await Escuelita.findOne({ clubId: user.clubId, socioId: user.socioId, active: true })
        .populate('planId', 'etiquetaId')
        .lean();
      const escuelitaEtiquetaId = alumno?.planId?.etiquetaId ? String(alumno.planId.etiquetaId) : null;
      const escuelita = escuelitaEtiquetaId
        ? deuda.suscripciones.find((s) => String(s.etiqueta?._id) === escuelitaEtiquetaId) ?? null
        : null;

      if (!social?.mesesDeuda && !escuelita?.mesesDeuda) continue;

      await sendPushNotification([{ userId: user._id, clubId: user.clubId, token: user.expoPushToken }], {
        title: `Recordatorio de cuotas - ${getMesActual()}`,
        body: buildBody(social, escuelita),
        data: { tipo: 'recordatorio_cuotas', url: 'carc://cuotas' },
      });
      notificados++;
    } catch (err) {
      console.error(`Error procesando socio ${user.socioId}:`, err.message);
    }
  }

  console.log(`📅 Recordatorio de cuotas: ${notificados} socios notificados`);
};

export const startRecordatorioCuotasJob = () => {
  // Corre el 1° de cada mes a las 9:15 — corrido 15 min de avisoMorosidad
  // (lunes 9:00), que coincide con este job los meses en que el 1° cae lunes.
  // Hora argentina: sin timezone corría a las 6:15 (appcarc-backend#283).
  cron.schedule('15 9 1 * *', async () => {
    try {
      await enviarRecordatorios();
    } catch (err) {
      console.error('❌ Error en recordatorio de cuotas:', err.message);
      await notifyJobFailure(DEFAULT_CLUB_ID, 'Recordatorio de cuotas', err.message);
    }
  }, { timezone: TIMEZONE_ARGENTINA });

  console.log('📅 Recordatorio de cuotas job iniciado (cada 1° del mes a las 9am)');
};
