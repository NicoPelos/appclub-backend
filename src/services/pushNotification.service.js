import User from '../resources/usuarios/models/User.js';
import Notification from '../resources/notificaciones/models/Notification.js';
import VinculoFamiliar from '../resources/vinculos/models/VinculoFamiliar.js';
import Rol from '../resources/roles/models/Rol.js';
import { obtenerRolIdsPorSlugs } from '../resources/roles/services/resolverRoles.service.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH_SIZE = 100; // Expo acepta hasta 100 por request

const isValidExpoToken = (token) =>
  typeof token === 'string' && token.startsWith('ExponentPushToken[');

const sendBatch = async (messages) => {
  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(messages),
  });

  if (!response.ok) {
    throw new Error(`Expo Push API error: ${response.status}`);
  }

  return response.json();
};

/**
 * Envía una notificación push a destinatarios específicos y guarda un registro
 * en el historial in-app de cada uno. El registro se guarda para todos los
 * destinatarios (tengan o no push token) — el push es solo el mecanismo de
 * entrega inmediata, la campanita de la app es la fuente de verdad del
 * historial (antes dependía de escuchar el push en el momento exacto en que
 * llegaba, así que se perdía si la app estaba cerrada).
 * @param {{ userId: string, clubId: string, token?: string|null }[]} recipients
 * @param {{ title: string, body: string, data?: object, socioId?: string|null }} notification
 */
export const sendPushNotification = async (recipients, { title, body, data = {}, socioId = null }) => {
  const list = (recipients ?? []).filter((r) => r?.userId && r?.clubId);
  if (list.length === 0) return { sent: 0 };

  await Notification.insertMany(
    list.map((r) => ({ clubId: r.clubId, userId: r.userId, socioId, title, body, data })),
  ).catch((error) => console.error('Error guardando historial de notificaciones:', error.message));

  const messages = list
    .filter((r) => isValidExpoToken(r.token))
    .map((r) => ({ to: r.token, title, body, data }));

  let sent = 0;
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    try {
      await sendBatch(batch);
      sent += batch.length;
    } catch (error) {
      console.error(`Error enviando batch de push notifications: ${error.message}`);
    }
  }

  return { sent };
};

/**
 * Envía una notificación push a todos los socios activos de un club.
 */
export const notifyClub = async (clubId, { title, body, data = {} }) => {
  const users = await User.find({ clubId, active: true }).select('expoPushToken').lean();

  return sendPushNotification(
    users.map((u) => ({ userId: u._id, clubId, token: u.expoPushToken })),
    { title, body, data },
  );
};

/**
 * Envía una notificación push a usuarios de un club con alguno de los roles indicados.
 *
 * Ojo: matchea por IDENTIDAD del rol (slug), no por lo que ese rol puede
 * hacer — si un club le saca un permiso a un rol pero el código sigue
 * pidiendo notifyRoles(clubId, ['ese-slug'], ...) a mano, ese rol sigue
 * recibiendo la notificación igual, sin importar que ya no tenga el permiso
 * relacionado (appcarc-backend#advertencias-permisos). Para notificaciones
 * sobre contenido gateado por un permiso puntual (ej. "hay una advertencia
 * nueva" -> advertencias:read), usar notifyRolesByPermiso en su lugar.
 */
export const notifyRoles = async (clubId, roles, { title, body, data = {} }) => {
  const rolIds = await obtenerRolIdsPorSlugs({ clubId, slugs: roles });
  const users = await User.find({ clubId, active: true, roles: { $in: rolIds } })
    .select('expoPushToken').lean();

  return sendPushNotification(
    users.map((u) => ({ userId: u._id, clubId, token: u.expoPushToken })),
    { title, body, data },
  );
};

/**
 * Envía una notificación push a los usuarios de un club cuyo rol tenga el
 * permiso indicado — a diferencia de notifyRoles (que matchea por slug de
 * rol hardcodeado), esto sigue siendo correcto aunque un club personalice
 * qué permisos tiene cada rol: si le sacan advertencias:read a "secretaria",
 * automáticamente deja de recibir notificaciones de advertencias, sin tener
 * que tocar código.
 */
export const notifyRolesByPermiso = async (clubId, permiso, { title, body, data = {} }) => {
  const rolIds = await Rol.find({ clubId, active: true, permisos: permiso }).select('_id').lean();
  const users = await User.find({ clubId, active: true, roles: { $in: rolIds.map((r) => r._id) } })
    .select('expoPushToken').lean();

  return sendPushNotification(
    users.map((u) => ({ userId: u._id, clubId, token: u.expoPushToken })),
    { title, body, data },
  );
};

/**
 * Envía una notificación push a quien corresponda por un socio específico:
 * su propia cuenta si tiene una (User.socioId === socioId), y además
 * cualquier tutor vinculado (VinculoFamiliar) — un hijo vinculado no
 * necesariamente tiene cuenta propia, así que sin esto la notificación se
 * perdía en silencio para toda la parte de la familia que entra "como" él.
 */
export const notifySocio = async (socioId, { title, body, data = {} }) => {
  const [propio, vinculos] = await Promise.all([
    User.findOne({ socioId: String(socioId), active: true }).select('expoPushToken clubId').lean(),
    VinculoFamiliar.find({ hijoSocioId: String(socioId), active: true }).select('padreUserId').lean(),
  ]);

  const recipients = [];
  const yaAgregado = new Set();

  if (propio) {
    recipients.push({ userId: propio._id, clubId: propio.clubId, token: propio.expoPushToken });
    yaAgregado.add(String(propio._id));
  }

  if (vinculos.length > 0) {
    const tutores = await User.find({
      _id: { $in: vinculos.map((v) => v.padreUserId) },
      active: true,
    }).select('expoPushToken clubId').lean();

    for (const tutor of tutores) {
      if (yaAgregado.has(String(tutor._id))) continue;
      recipients.push({ userId: tutor._id, clubId: tutor.clubId, token: tutor.expoPushToken });
      yaAgregado.add(String(tutor._id));
    }
  }

  if (recipients.length === 0) return { sent: 0 };
  return sendPushNotification(recipients, { title, body, data, socioId: String(socioId) });
};

/**
 * Avisa al admin cuando un job programado (cron) falla — sin esto, un error
 * de un proceso que corre solo de madrugada (ej. la exportación a Google
 * Sheets, el aviso de morosidad) quedaba solo en el log del contenedor, que
 * nadie mira salvo que ya sospeche que algo anda mal. No hace falta avisar
 * cuando el job corre bien, solo cuando falla.
 * @param {string} clubId
 * @param {string} jobName - nombre corto para identificar qué job fue (ej. "Exportación a Google Sheets")
 * @param {string} errorMessage
 */
export const notifyJobFailure = async (clubId, jobName, errorMessage) => {
  try {
    await notifyRoles(clubId, ['admin'], {
      title: `⚠️ Falló: ${jobName}`,
      body: errorMessage?.slice(0, 200) || 'Sin detalle del error — revisar los logs del servidor.',
      data: { tipo: 'job_error', job: jobName },
    });
  } catch (err) {
    // Si hasta avisar del error falla, no hay mucho más para hacer acá salvo
    // no dejar que rompa el job que lo llamó.
    console.error(`No se pudo notificar la falla de "${jobName}":`, err.message);
  }
};
