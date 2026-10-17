import Escuelita from '../models/Escuelita.js';
import Cuota from '../../cuotas/models/Cuota.js';
import Etiqueta from '../../etiquetas/models/Etiqueta.js';
import Asistencia from '../../asistencias/models/Asistencia.js';
import VinculoFamiliar from '../../vinculos/models/VinculoFamiliar.js';
import { resolveSocioFromQrTokenOrDni, findActiveSocioById, BusinessError } from '../../socios/services/socioQr.service.js';
import { estaExentoEnPeriodo } from '../../cuotas/services/exencion.service.js';
import { ADVERTENCIA } from '../../../constants/advertenciaCodes.js';
import { notifyRolesByPermiso, notifySocio } from '../../../services/pushNotification.service.js';
import { periodoDeFecha, diaBoundsUTC, semanaBoundsUTC, dentroDeVentanaDeGracia, esFechaFutura } from '../../../services/fechaArgentina.js';
import { tienePermiso } from '../../../services/permisosCache.js';
import { PERMISOS } from '../../../constants/permisos.js';
import { getActor } from '../../../services/getActor.js';

/**
 * @openapi
 * /api/escuelita/checkin:
 *   post:
 *     summary: Registrar asistencia a escuelita
 *     tags: [Escuelita]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token:
 *                 type: string
 *                 description: Token QR del socio
 *               dni:
 *                 type: string
 *                 description: DNI del socio
 *               hijoSocioId:
 *                 type: string
 *                 description: Solo para autoescaneo (escuelita:checkin_propio) — id del hijo vinculado a marcar en vez del propio usuario. Requiere VinculoFamiliar activo.
 *               observaciones:
 *                 type: string
 *               fecha:
 *                 type: string
 *                 format: date-time
 *                 description: Fecha del check-in (default ahora) — para cargar asistencia de un día anterior
 *     responses:
 *       201:
 *         description: Asistencia registrada
 *       400:
 *         description: Datos inválidos
 *       404:
 *         description: Socio o alumno no encontrado
 *       500:
 *         description: Error al registrar asistencia
 */
export const checkinEscuelitaHandler = async (req, res) => {
  try {
    const { token, dni, hijoSocioId, observaciones, fecha: fechaRaw } = req.body;
    const { clubId } = req.user;
    const actor = getActor(req);

    const fecha = fechaRaw ? new Date(fechaRaw) : new Date();
    if (Number.isNaN(fecha.getTime())) {
      return res.status(400).json({ message: 'La fecha es inválida' });
    }
    if (esFechaFutura(fecha)) {
      return res.status(400).json({ message: 'La fecha de la asistencia no puede ser futura' });
    }

    // La decisión de qué flujo usar depende de si LA REQUEST trae token/dni
    // explícito, no de qué permisos tiene quien llama — un miembro del staff
    // que además tiene un hijo en la escuelita y escanea el cartel de pared
    // para autoescanearlo tiene que poder hacerlo igual (appCARC-mobile#60,
    // mismo bug que en checkinMuroLibre.handler.js: esStaff daba true y
    // forzaba siempre el flujo de "identificar por QR/DNI de otro socio").
    const identificacionExplicita = Boolean(token || dni);

    // 1. Identificar socio: por QR/DNI de cualquiera (requiere permiso de
    // staff); autoescaneo del QR de pared solo puede apuntar al propio
    // usuario o a un hijo vinculado (VinculoFamiliar activo) — nunca a un
    // socio libre.
    let socio;
    let method;

    if (identificacionExplicita) {
      const roles = req.user.roles ?? [];
      const esStaff = roles.includes('superadmin')
        || await tienePermiso(clubId, roles, PERMISOS.ESCUELITA_CHECKIN);
      if (!esStaff) {
        return res.status(403).json({ message: 'No tenés permiso para registrar la asistencia de otro socio' });
      }
      ({ socio, method } = await resolveSocioFromQrTokenOrDni({
        token,
        dni,
        clubId,
        missingMessage: 'Se requiere token QR o DNI',
        dniNotFoundMessage: 'Socio no encontrado por DNI',
      }));
    } else {
      const targetSocioId = hijoSocioId || req.user.socioId;
      if (!targetSocioId) {
        return res.status(403).json({ message: 'Tu usuario no tiene un socio asociado ni indicaste un hijo vinculado' });
      }
      if (hijoSocioId && hijoSocioId !== req.user.socioId) {
        const vinculo = await VinculoFamiliar.exists({
          clubId, padreUserId: req.user.id, hijoSocioId, active: true,
        });
        if (!vinculo) {
          return res.status(403).json({ message: 'Ese socio no está vinculado a tu cuenta' });
        }
      }
      socio = await findActiveSocioById(targetSocioId, clubId);
      if (!socio) {
        return res.status(404).json({ message: 'Socio no encontrado o inactivo' });
      }
      method = 'SELF';
    }

    // 2. Buscar inscripción activa en escuelita
    const alumno = await Escuelita.findOne({ clubId, socioId: socio._id, active: true })
      .populate('planId', 'nombre atributos etiquetaId');

    if (!alumno) {
      return res.status(404).json({ message: 'El socio no está inscripto en la escuelita' });
    }

    const plan = alumno.planId;
    const frecuenciaSemanal = plan?.atributos?.frecuenciaSemanal ?? 1;

    const advertencias = [];
    const periodo = periodoDeFecha(fecha);

    // Ventana de gracia: la cuota del mes en curso no se "reclama" (no genera
    // advertencia) hasta pasado el día 10 — recién el 11 se la considera
    // atrasada. Solo aplica al mes REAL en curso, no a un check-in cargado
    // con fecha pasada (ahí el período ya está vencido hace tiempo, se
    // avisa igual sin importar el día de hoy).
    const hoy = new Date();
    const enVentanaDeGracia = periodo === periodoDeFecha(hoy) && dentroDeVentanaDeGracia(hoy);

    // 3a. Verificar cuota social del mes (advertencia, no bloquea)
    const etiquetaSocial = await Etiqueta.findOne({ clubId, uso_sistema: 'cuota_social', active: true }).lean();
    const cuotaSocial = etiquetaSocial && await Cuota.findOne({
      clubId,
      socioId: socio._id,
      etiquetaId: etiquetaSocial._id,
      periodo,
      estado: 'pagada',
    }).lean();

    const exentoSocial = !cuotaSocial && etiquetaSocial && await estaExentoEnPeriodo({
      clubId, socioId: socio._id, etiquetaId: etiquetaSocial._id, periodo,
    });

    if (!cuotaSocial && !exentoSocial && !enVentanaDeGracia) {
      advertencias.push({
        codigo: ADVERTENCIA.CUOTA_SOCIAL_IMPAGA,
        mensaje: `Sin cuota social pagada para ${periodo}`,
      });
    }

    // 3b. Verificar cuota de escuelita del mes (advertencia, no bloquea).
    // BUG appcarc-backend#156: acá se buscaba SIEMPRE la única etiqueta con
    // uso_sistema 'cuota_escuelita' — pero hay varias etiquetas de cuota de
    // escuelita distintas según el plan (X1 vs X2, Adultos, etc.), solo una
    // de ellas tiene ese uso_sistema tageado. Para cualquier plan que use
    // otra etiqueta (ej. AvanzadosX1, AdultosX1/X2) esto SIEMPRE daba "sin
    // pagar" así hubiera pagado, porque chequeaba una etiqueta que no era la
    // suya. La etiqueta correcta es la del plan en el que está inscripto.
    const etiquetaEscuelitaId = plan?.etiquetaId ?? null;
    const cuotaPagada = etiquetaEscuelitaId && await Cuota.findOne({
      clubId,
      socioId: socio._id,
      etiquetaId: etiquetaEscuelitaId,
      periodo,
      estado: 'pagada',
    }).lean();

    const exentoEscuelita = !cuotaPagada && await estaExentoEnPeriodo({
      clubId, socioId: socio._id, etiquetaId: etiquetaEscuelitaId, periodo,
    });

    if (!cuotaPagada && !exentoEscuelita && !enVentanaDeGracia) {
      advertencias.push({
        codigo: ADVERTENCIA.CUOTA_IMPAGA,
        mensaje: `Sin cuota de escuelita pagada para ${periodo}`,
      });
    }

    // 4. Contar clases de la semana del check-in (advertencia, no bloquea)
    const { start, end } = semanaBoundsUTC(fecha);
    const clasesEstaSemana = await Asistencia.countDocuments({
      clubId,
      socioId: socio._id,
      tipo: 'escuelita',
      active: true,
      fecha: { $gte: start, $lte: end },
    });

    if (clasesEstaSemana >= frecuenciaSemanal) {
      advertencias.push({
        codigo: ADVERTENCIA.LIMITE_SEMANAL,
        mensaje: `Ya registró ${clasesEstaSemana} clase${clasesEstaSemana !== 1 ? 's' : ''} esa semana (límite: ${frecuenciaSemanal})`,
      });
    }

    // 5. Verificar que no haya otra asistencia registrada ese mismo día (bloqueo duro)
    const { start: startUTC, end: endUTC } = diaBoundsUTC(fecha);

    const asistenciaEseDia = await Asistencia.findOne({
      clubId,
      socioId: socio._id,
      tipo: 'escuelita',
      active: true,
      fecha: { $gte: startUTC, $lte: endUTC },
    }).lean();

    if (asistenciaEseDia) {
      return res.status(409).json({
        message: `${socio.nombre} ${socio.apellido} ya tiene una asistencia registrada ese día`,
      });
    }

    // 6. Registrar asistencia
    const asistencia = await Asistencia.create({
      clubId,
      tipo: 'escuelita',
      socioId: socio._id,
      nombre: socio.nombre,
      apellido: socio.apellido,
      dni: socio.dni,
      esSocio: true,
      fecha,
      categoria: plan?.nombre || '',
      advertencias,
      observaciones: String(observaciones || '').trim(),
      checkinMethod: method,
      scannedBy: req.user.id,
      createdBy: actor,
      updatedBy: actor,
    });

    if (advertencias.length > 0) {
      const nombreCompleto = `${socio.nombre} ${socio.apellido}`;
      const resumen = advertencias.map((a) => a.mensaje).join(' | ');
      Promise.all([
        notifyRolesByPermiso(clubId, PERMISOS.ADVERTENCIAS_READ, {
          title: '⚠️ Ingreso con advertencias',
          body: `${nombreCompleto} ingresó a escuelita con ${advertencias.length} advertencia(s): ${resumen}`,
          data: { tipo: 'advertencia_checkin', asistenciaId: String(asistencia._id), url: 'carc://advertencias?tipo=escuelita' },
        }),
        notifySocio(socio._id, {
          title: '⚠️ Advertencias en tu ingreso',
          body: resumen,
          data: { tipo: 'advertencia_socio', url: 'carc://cuotas' },
        }),
      ]).catch((err) => console.error('[Push] Error enviando notificaciones de advertencia:', err.message));
    }

    return res.status(201).json({
      asistencia,
      socio: { _id: socio._id, nombre: socio.nombre, apellido: socio.apellido },
      clasesEstaSemana: clasesEstaSemana + 1,
      limiteClases: frecuenciaSemanal,
      advertencias,
    });
  } catch (error) {
    if (error instanceof BusinessError || error.status) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error('Error en checkin escuelita:', error);
    return res.status(500).json({ message: 'Error al registrar asistencia' });
  }
};

export default checkinEscuelitaHandler;
