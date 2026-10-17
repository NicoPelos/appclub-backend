import cron from 'node-cron';
import Precios from '../resources/cuotas/models/Precios.js';
import Suscripcion from '../resources/suscripciones/models/Suscripcion.js';
import Horarios from '../resources/horarios/models/Horarios.js';
import { notifyRolesByPermiso, notifySocio, notifyJobFailure } from '../services/pushNotification.service.js';
import { diaBoundsUTC, fechaCalendarioArgentina } from '../services/fechaArgentina.js';
import { PERMISOS } from '../constants/permisos.js';
import { TIMEZONE_ARGENTINA } from '../services/fechaArgentina.js';

const DEFAULT_CLUB_ID = process.env.DEFAULT_CLUB_ID || 'CARC';
// Escalones del aviso de vencimiento sin reemplazo (appcarc-backend#317): se
// avisa una vez al entrar en cada uno, no todos los días.
const ESCALONES_AVISO_DIAS = [30, 14, 7, 1];
const DIA_MS = 24 * 60 * 60 * 1000;

const formatMonto = (n) => `$${Number(n).toLocaleString('es-AR')}`;
// vigenteDesde/vigenteHasta se guardan como medianoche UTC del día calendario
// (ver resolverVigenciaPrecio), así que se formatean en UTC. Armado a mano:
// toLocaleDateString con day+month devuelve "28-agosto" según el ICU de Node.
const formatFechaAR = (d) => {
  const f = new Date(d);
  return `${f.getUTCDate()} de ${f.toLocaleDateString('es-AR', { month: 'long', timeZone: 'UTC' })}`;
};
const addDays = (date, days) => new Date(date.getTime() + days * DIA_MS);

// Medianoche UTC del día calendario de hoy en Argentina, misma convención que vigenteHasta.
const hoyComoFechaCalendario = () => new Date(`${fechaCalendarioArgentina(new Date())}T00:00:00.000Z`);

const inicioDiaUTC = (d) => {
  const f = new Date(d);
  return Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate());
};

// Escalón que corresponde a los días que faltan: 20 → 30, 10 → 14, 3 → 7, 0 → 1.
export const escalonAviso = (diasRestantes) => ESCALONES_AVISO_DIAS
  .filter((e) => diasRestantes <= e)
  .reduce((min, e) => Math.min(min, e), Infinity);

// Ya se mandó el aviso de este escalón (o uno más cercano) para este mismo vigenteHasta.
const yaAvisado = (aviso, vigenteHasta, escalon) => Boolean(aviso)
  && inicioDiaUTC(aviso.vigenteHasta) === inicioDiaUTC(vigenteHasta)
  && aviso.diasAntes <= escalon;

const cuandoVence = (vigenteHasta, diasRestantes) => {
  if (diasRestantes === 0) return 'vence hoy';
  if (diasRestantes === 1) return 'vence mañana';
  return `vence el ${formatFechaAR(vigenteHasta)} (faltan ${diasRestantes} días)`;
};

// Quién se ve afectado por el precio de una etiqueta: si es una tarifa por
// hora (ej. "Hora Profesor"), el staff no tiene una suscripción a su propia
// tarifa — el afectado es quien carga horas contra esa etiqueta. Para el
// resto (cuota social, escuelita, etc.) es quien tiene una suscripción activa.
const buscarSocioIdsAfectados = async ({ clubId, etiquetaId, unidad }) => {
  if (unidad === 'hora') {
    return Horarios.distinct('socioId', { clubId, etiquetaId, active: true, socioId: { $ne: null } });
  }
  return Suscripcion.distinct('socioId', { clubId, etiquetaId, active: true });
};

// ─── 1. Avisar si un precio vence pronto y no hay uno nuevo que lo reemplace ──

export const revisarVencimientosSinReemplazo = async () => {
  console.log('💰 Alerta de precios: revisando vencimientos sin reemplazo...');
  const hoy = hoyComoFechaCalendario();
  const limite = addDays(hoy, Math.max(...ESCALONES_AVISO_DIAS));

  const porVencer = await Precios.find({
    active: true,
    vigenteHasta: { $ne: null, $gte: hoy, $lte: limite },
  }).populate('etiquetaId', 'nombre').lean();

  let avisados = 0;
  for (const precio of porVencer) {
    if (!precio.etiquetaId) continue;

    const diasRestantes = Math.round((inicioDiaUTC(precio.vigenteHasta) - hoy.getTime()) / DIA_MS);
    const escalon = escalonAviso(diasRestantes);
    if (yaAvisado(precio.avisoVencimiento, precio.vigenteHasta, escalon)) continue;

    const diaSiguiente = addDays(precio.vigenteHasta, 1);
    const reemplazo = await Precios.findOne({
      clubId: precio.clubId,
      etiquetaId: precio.etiquetaId._id,
      active: true,
      _id: { $ne: precio._id },
      vigenteDesde: { $lte: diaSiguiente },
      $or: [{ vigenteHasta: null }, { vigenteHasta: { $gte: diaSiguiente } }],
    }).lean();
    if (reemplazo) continue;

    try {
      // notifyRolesByPermiso también lo guarda en el historial in-app de cada
      // destinatario (campanita de la app y del panel web), así que llega
      // aunque no tenga la app móvil con push.
      await notifyRolesByPermiso(precio.clubId, PERMISOS.PRECIOS_READ, {
        title: '⚠️ Precio por vencer sin reemplazo',
        body: `"${precio.etiquetaId.nombre}" ${cuandoVence(precio.vigenteHasta, diasRestantes)} y no hay un precio nuevo cargado para después. Cargalo en Etiquetas → Precios para no dejar a nadie sin precio.`,
        data: { tipo: 'precio_por_vencer', precioId: String(precio._id), diasRestantes, url: `carc://precios?precioId=${precio._id}` },
      });
      // Si el aviso falla no se marca, así se reintenta mañana.
      await Precios.updateOne(
        { _id: precio._id, clubId: precio.clubId },
        { $set: { avisoVencimiento: { vigenteHasta: precio.vigenteHasta, diasAntes: escalon } } },
      );
      avisados++;
    } catch (err) {
      console.error(`Error avisando vencimiento del precio ${precio._id}:`, err.message);
    }
  }

  console.log(`💰 Alerta de precios: ${avisados} avisos de vencimiento enviados`);
};

// ─── 2. Avisar el día que un precio nuevo reemplaza a uno anterior ────────────

export const revisarCambiosDePrecio = async () => {
  console.log('💰 Alerta de precios: revisando cambios de precio de hoy...');
  const { start: inicioHoy, end: finHoy } = diaBoundsUTC(new Date());
  const ayer = addDays(inicioHoy, -1);

  const nuevos = await Precios.find({
    active: true,
    vigenteDesde: { $gte: inicioHoy, $lte: finHoy },
  }).populate('etiquetaId', 'nombre unidad').lean();

  let avisados = 0;
  for (const nuevo of nuevos) {
    if (!nuevo.etiquetaId) continue;

    const anterior = await Precios.findOne({
      clubId: nuevo.clubId,
      etiquetaId: nuevo.etiquetaId._id,
      active: true,
      _id: { $ne: nuevo._id },
      vigenteDesde: { $lte: ayer },
      $or: [{ vigenteHasta: null }, { vigenteHasta: { $gte: ayer } }],
    }).sort({ vigenteDesde: -1 }).lean();

    // Sin precio anterior (etiqueta nueva) o mismo monto (edición sin cambio real): no avisar.
    if (!anterior || anterior.monto === nuevo.monto) continue;

    const nombre = nuevo.etiquetaId.nombre;
    const cambio = `de ${formatMonto(anterior.monto)} a ${formatMonto(nuevo.monto)}`;

    try {
      await notifyRolesByPermiso(nuevo.clubId, PERMISOS.PRECIOS_READ, {
        title: '💰 Cambio de precio',
        body: `"${nombre}" cambió ${cambio} a partir de hoy.`,
        data: { tipo: 'precio_cambio', precioId: String(nuevo._id), url: `carc://precios?precioId=${nuevo._id}` },
      });

      const socioIds = await buscarSocioIdsAfectados({
        clubId: nuevo.clubId,
        etiquetaId: nuevo.etiquetaId._id,
        unidad: nuevo.etiquetaId.unidad,
      });
      for (const socioId of socioIds) {
        await notifySocio(socioId, {
          title: '💰 Cambio de precio',
          body: `La cuota de "${nombre}" cambió ${cambio} a partir de hoy.`,
          data: { tipo: 'precio_cambio', precioId: String(nuevo._id), url: `carc://precios?precioId=${nuevo._id}` },
        }).catch((err) => console.error(`Error notificando cambio de precio a socio ${socioId}:`, err.message));
      }

      avisados++;
    } catch (err) {
      console.error(`Error avisando cambio del precio ${nuevo._id}:`, err.message);
    }
  }

  console.log(`💰 Alerta de precios: ${avisados} cambios de precio notificados`);
};

export const startAlertaPreciosJob = () => {
  // Corre todos los días a las 8am, hora argentina (appcarc-backend#283).
  cron.schedule('0 8 * * *', async () => {
    try {
      await revisarVencimientosSinReemplazo();
      await revisarCambiosDePrecio();
    } catch (err) {
      console.error('❌ Error en alerta de precios:', err.message);
      await notifyJobFailure(DEFAULT_CLUB_ID, 'Alerta de precios', err.message);
    }
  }, { timezone: TIMEZONE_ARGENTINA });

  console.log('💰 Alerta de precios job iniciado (todos los días a las 8am)');
};
