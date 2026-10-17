import cron from 'node-cron';
import Club from '../resources/clubs/models/Club.js';
import Socio from '../resources/socios/models/Socio.js';
import Advertencia from '../resources/advertencias/models/Advertencia.js';
import { calcularDeuda } from '../resources/cuotas/services/calcularDeuda.service.js';
import { notifyRolesByPermiso, notifyJobFailure } from '../services/pushNotification.service.js';
import { ADVERTENCIA } from '../constants/advertenciaCodes.js';
import { PERMISOS } from '../constants/permisos.js';
import { dentroDeVentanaDeGracia } from '../services/fechaArgentina.js';
import { filtroSociosVigentes } from '../resources/socios/services/sociosVigentes.service.js';
import { TIMEZONE_ARGENTINA } from '../services/fechaArgentina.js';

const MESES_AVISO = 3;

const buildMensaje = (mesesDeuda) => `Debe ${mesesDeuda} ${mesesDeuda === 1 ? 'mes' : 'meses'} de cuota social`;

const revisarClub = async (club) => {
  const clubId = club.slug;

  const [socios, abiertas] = await Promise.all([
    Socio.find(filtroSociosVigentes(clubId)).select('nombre apellido').lean(),
    Advertencia.find({ clubId, codigo: ADVERTENCIA.MOROSIDAD_CUOTA_SOCIAL, estado: 'abierta' }),
  ]);

  const abiertasPorSocio = new Map(abiertas.map((a) => [String(a.socioId), a]));
  const morosos = [];

  const hoy = new Date();

  for (const socio of socios) {
    const deuda = await calcularDeuda({ socioId: socio._id, clubId });
    const cuotaSocial = deuda.suscripciones.find((s) => s.etiqueta?.uso_sistema === 'cuota_social');
    if (!cuotaSocial) continue;

    // Ventana de gracia: el mes en curso no cuenta para el aviso de
    // morosidad hasta pasado el día 10 — un socio que recién acumuló su 3er
    // mes de deuda PORQUE arrancó el mes actual no se avisa todavía; uno que
    // ya venía atrasado de antes (3+ meses sin contar el actual) se avisa
    // igual, sin esperar al día 11.
    const mesesDeuda = dentroDeVentanaDeGracia(hoy) && cuotaSocial.periodos.includes(cuotaSocial.periodoActual)
      ? cuotaSocial.mesesDeuda - 1
      : cuotaSocial.mesesDeuda;

    if (mesesDeuda >= MESES_AVISO) {
      morosos.push({ socio, mesesDeuda });
    }
  }

  const now = new Date();
  const morososIds = new Set(morosos.map((m) => String(m.socio._id)));

  for (const { socio, mesesDeuda } of morosos) {
    const existing = abiertasPorSocio.get(String(socio._id));
    const mensaje = buildMensaje(mesesDeuda);
    if (existing) {
      existing.mensaje = mensaje;
      existing.ultimaRevision = now;
      await existing.save();
    } else {
      await Advertencia.create({
        clubId,
        socioId: socio._id,
        codigo: ADVERTENCIA.MOROSIDAD_CUOTA_SOCIAL,
        mensaje,
        nombre: socio.nombre,
        apellido: socio.apellido,
        estado: 'abierta',
        detectadoEn: now,
        ultimaRevision: now,
      });
    }
  }

  for (const [socioId, advertencia] of abiertasPorSocio) {
    if (!morososIds.has(socioId)) {
      advertencia.estado = 'resuelta';
      advertencia.resueltoEn = now;
      await advertencia.save();
    }
  }

  if (morosos.length > 0) {
    await notifyRolesByPermiso(clubId, PERMISOS.ADVERTENCIAS_READ, {
      title: '⚠️ Socios con cuota social atrasada',
      body: `${morosos.length} ${morosos.length === 1 ? 'socio lleva' : 'socios llevan'} 3+ meses sin pagar la cuota social. Revisá el detalle en Advertencias.`,
      data: { tipo: 'morosidad_cuota_social', url: 'carc://advertencias?tipo=morosidad' },
    });
  }

  return morosos.length;
};

export const revisarMorosidadCuotaSocial = async () => {
  console.log('⚠️ Aviso de morosidad: revisando cuota social por club...');
  const clubs = await Club.find({ active: true });

  let totalMorosos = 0;
  for (const club of clubs) {
    try {
      totalMorosos += await revisarClub(club);
    } catch (err) {
      console.error(`❌ Aviso de morosidad [${club.slug}]: error revisando:`, err.message);
      await notifyJobFailure(club.slug, 'Aviso de morosidad', err.message);
    }
  }

  console.log(`⚠️ Aviso de morosidad: ${totalMorosos} socios morosos detectados en total`);
};

export const startAvisoMorosidadJob = () => {
  // Corre todos los lunes a las 9am, hora argentina (sin timezone, con el
  // container en UTC, corría a las 6 — appcarc-backend#283).
  cron.schedule('0 9 * * 1', async () => {
    try {
      await revisarMorosidadCuotaSocial();
    } catch (err) {
      console.error('❌ Error en aviso de morosidad:', err.message);
    }
  }, { timezone: TIMEZONE_ARGENTINA });

  console.log('⚠️ Aviso de morosidad job iniciado (lunes a las 9am)');
};
