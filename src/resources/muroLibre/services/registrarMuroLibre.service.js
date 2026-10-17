import mongoose from 'mongoose';
import { pasesIncluidosSemana, MOTIVO_EXENTO_PLAN_CLASES } from './pasesClases.service.js';
import Socio from '../../socios/models/Socio.js';
import Cuota from '../../cuotas/models/Cuota.js';
import Precios from '../../cuotas/models/Precios.js';
import Etiqueta from '../../etiquetas/models/Etiqueta.js';
import { crearMovimientoDePago } from '../../movimientos/services/crearMovimientoDePago.service.js';
import Asistencia from '../../asistencias/models/Asistencia.js';
import Suscripcion from '../../suscripciones/models/Suscripcion.js';
import { estaExentoEnPeriodo } from '../../cuotas/services/exencion.service.js';
import { ADVERTENCIA } from '../../../constants/advertenciaCodes.js';
import { dentroDeVentanaDeGracia, esFechaFutura, diaBoundsUTC, fechaCalendarioArgentina, periodoDeFecha, periodoActualArgentino } from '../../../services/fechaArgentina.js';
import { detallePrecioNoVigente, mensajePrecioNoVigente } from '../../../services/precioNoVigente.js';

const VALID_PAYMENT_METHODS = ['Efectivo', 'Transferencia'];
const VALID_TIPO_PASE = ['diario', 'mensual'];

export const USO_SISTEMA_BY_TIPO = {
  diario: {
    socio: 'muro_libre_diario_socio',
    noSocio: 'muro_libre_diario_no_socio',
  },
  mensual: {
    socio: 'muro_libre_mensual_socio',
    noSocio: 'muro_libre_mensual_no_socio',
  },
};

class BusinessError extends Error {
  constructor(message, status = 400, data = null) {
    super(message);
    this.name = 'BusinessError';
    this.status = status;
    this.data = data;
  }
}

// Día calendario en America/Argentina (UTC-3, sin horario de verano) —
// appcarc-backend#160: reusa fechaArgentina.js en vez de reimplementarlo.
const buildDiaCheckin = (date) => fechaCalendarioArgentina(date);

export const findPrecioVigenteByUsoSistema = async ({ clubId, uso_sistema, date, session = null }) => {
  const etiqueta = await Etiqueta.findOne({ clubId, uso_sistema, active: true }).lean();
  if (!etiqueta) return null;

  const query = Precios.findOne({
    clubId,
    etiquetaId: etiqueta._id,
    active: true,
    vigenteDesde: { $lte: date },
    $or: [{ vigenteHasta: null }, { vigenteHasta: { $gte: date } }],
  }).sort({ vigenteDesde: -1 });

  return session ? query.session(session) : query;
};

export const registrarMuroLibre = async ({ clubId, user, body, scannedBy = null, checkinMethod = 'MANUAL', advertencias = [] }) => {
  if (!clubId) {
    throw new BusinessError('No se pudo determinar el club del usuario', 401);
  }

  const tipoPase = String(body?.tipoPase || '').trim().toLowerCase();
  if (!VALID_TIPO_PASE.includes(tipoPase)) {
    throw new BusinessError('El tipo de pase debe ser diario o mensual');
  }

  const fecha = body?.fecha ? new Date(body.fecha) : new Date();
  if (Number.isNaN(fecha.getTime())) {
    throw new BusinessError('La fecha de muro libre es inválida');
  }
  if (esFechaFutura(fecha)) {
    throw new BusinessError('La fecha de la asistencia no puede ser futura');
  }

  const session = await mongoose.startSession();
  // Hoisteados fuera de la transacción para poder armar el mismo mensaje de
  // error si el catch de más abajo termina resolviendo el duplicado en vez
  // del chequeo en memoria.
  let nombre = '';
  let apellido = '';
  try {
    let result = null;

    await session.withTransaction(async () => {
      let socio = null;
      const socioId = String(body?.socioId || '').trim();
      if (socioId) {
        socio = await Socio.findOne({ _id: socioId, clubId, active: true }).session(session);
        if (!socio) {
          throw new BusinessError('El socio no existe, está inactivo o pertenece a otro club', 404);
        }
      }

      // Un socio dado de Baja ya no es parte del club: para el muro cuenta como
      // no socio (precio de no socio, sin pase mensual). Adherente y Activo
      // siguen siendo socios. Sin ficha (visitante externo) decide el body.
      const socioVigente = Boolean(socio) && socio.estado !== 'Baja';
      const esSocio = socio ? socioVigente : body?.esSocio === true;
      nombre = String(body?.nombre || socio?.nombre || '').trim();
      apellido = String(body?.apellido || socio?.apellido || '').trim();
      const dni = String(body?.dni || socio?.dni || '').trim();

      if (!nombre) {
        throw new BusinessError('El nombre es obligatorio');
      }

      // Verificar asistencia duplicada en el mismo día (solo socios, bloqueo duro)
      if (socio) {
        const { start: startUTC, end: endUTC } = diaBoundsUTC(fecha);

        const existente = await Asistencia.findOne({
          clubId,
          socioId: socio._id,
          tipo: 'muro_libre',
          active: true,
          fecha: { $gte: startUTC, $lte: endUTC },
        }).session(session).lean();

        if (existente) {
          throw new BusinessError(`${nombre} ${apellido} ya registró asistencia en muro libre hoy`, 409);
        }
      }

      // Un socio con pase mensual activo no puede anotarse como diario —
      // bloqueo duro, no solo una advertencia. Pasó varias veces que quedaba
      // mal clasificado y había que corregirlo a mano en la base porque
      // encima el endpoint de edición no permite cambiar el tipoPase (ver
      // updateMuroLibre.handler.js).
      if (socio && tipoPase === 'diario') {
        const etiquetaMensualCheck = await Etiqueta.findOne({
          clubId,
          uso_sistema: 'muro_libre_mensual_socio',
          active: true,
        }).lean();
        // Solo cuenta un pase mensual vigente en el período del check-in: uno
        // programado a futuro (ej. "desde octubre") o uno ya cerrado (fechaHasta
        // pasada) no impide cargar un diario hoy (appcarc-backend#277).
        const periodoCheckin = periodoDeFecha(fecha);
        const suscripcionMensualActiva = etiquetaMensualCheck && await Suscripcion.findOne({
          clubId,
          socioId: socio._id,
          etiquetaId: etiquetaMensualCheck._id,
          active: true,
          fechaDesde: { $lte: periodoCheckin },
          $or: [{ fechaHasta: null }, { fechaHasta: { $gte: periodoCheckin } }],
        }).session(session).lean();

        if (suscripcionMensualActiva) {
          throw new BusinessError(`${nombre} ${apellido} ya tiene un pase mensual activo — registrá el check-in como mensual, no diario`);
        }
      }

      // Cuota social vigente (advertencia, no bloquea — solo para socios
      // vigentes: a uno dado de Baja no se le reclama cuota social)
      if (socioVigente) {
        const periodoActual = periodoDeFecha(fecha);
        // Ventana de gracia: el mes en curso no se reclama hasta pasado el
        // día 10 — solo aplica si `fecha` es realmente el mes actual, no un
        // check-in cargado con fecha pasada (ver mismo criterio en
        // checkinEscuelita.handler.js).
        const enVentanaDeGracia = periodoActual === periodoActualArgentino() && dentroDeVentanaDeGracia(new Date());
        const etiquetaSocial = await Etiqueta.findOne({ clubId, uso_sistema: 'cuota_social', active: true }).lean();
        const cuotaSocial = etiquetaSocial && await Cuota.findOne({
          clubId,
          socioId: socio._id,
          etiquetaId: etiquetaSocial._id,
          periodo: periodoActual,
          estado: 'pagada',
          active: true,
        }).session(session).lean();

        const exentoSocial = !cuotaSocial && etiquetaSocial && await estaExentoEnPeriodo({
          clubId, socioId: socio._id, etiquetaId: etiquetaSocial._id, periodo: periodoActual, session,
        });

        if (!cuotaSocial && !exentoSocial && !enVentanaDeGracia) {
          advertencias.push({
            codigo: ADVERTENCIA.CUOTA_SOCIAL_IMPAGA,
            mensaje: `Sin cuota social pagada para ${periodoActual}`,
          });
        }
      }

      // Pase mensual: requiere una Suscripcion real a la etiqueta muro_libre_mensual_socio.
      // Si el socio todavía no está suscripto, se lo suscribe en este mismo check-in.
      let estadoPagoOverride = null;
      let etiquetaMensual = null;
      let suscripcionMensual = null;
      let periodoMensual = null;
      let cuotaMensualVigente = null;

      if (tipoPase === 'mensual') {
        if (!socioVigente) {
          throw new BusinessError('El pase mensual solo está disponible para socios');
        }

        periodoMensual = periodoDeFecha(fecha);
        etiquetaMensual = await Etiqueta.findOne({
          clubId,
          uso_sistema: 'muro_libre_mensual_socio',
          active: true,
        }).lean();

        if (!etiquetaMensual) {
          throw new BusinessError('No hay una etiqueta de Muro Libre Mensual configurada para este club');
        }

        // Solo sirve una suscripción vigente en el período del check-in o
        // programada a futuro (se le adelanta el inicio más abajo). Una ya
        // cerrada no se reusa: si no hay otra, se crea una nueva desde este
        // período (appcarc-backend#282). El sort prefiere la vigente.
        suscripcionMensual = await Suscripcion.findOne({
          clubId,
          socioId: socio._id,
          etiquetaId: etiquetaMensual._id,
          active: true,
          $or: [{ fechaHasta: null }, { fechaHasta: { $gte: periodoMensual } }],
        }).sort({ fechaDesde: 1 }).session(session);

        cuotaMensualVigente = await Cuota.findOne({
          socioId: socio._id,
          clubId,
          etiquetaId: etiquetaMensual._id,
          periodo: periodoMensual,
          estado: 'pagada',
          active: true,
        }).session(session);

        const enVentanaDeGraciaPaseMensual = periodoMensual === periodoActualArgentino() && dentroDeVentanaDeGracia(new Date());
        const exentoMensual = !cuotaMensualVigente && await estaExentoEnPeriodo({
          clubId, socioId: socio._id, etiquetaId: etiquetaMensual._id, periodo: periodoMensual, session,
        });
        if (cuotaMensualVigente || exentoMensual) {
          estadoPagoOverride = 'exento';
        } else if (String(body?.estadoPago || 'pendiente').trim().toLowerCase() !== 'pagado' && !enVentanaDeGraciaPaseMensual) {
          advertencias.push({
            codigo: ADVERTENCIA.PASE_MENSUAL_IMPAGO,
            mensaje: `Sin pase mensual pagado para ${periodoMensual}`,
          });
        }
      }

      let estadoPago = estadoPagoOverride ?? String(body?.estadoPago || 'pendiente').trim().toLowerCase();
      if (!['pagado', 'pendiente', 'exento'].includes(estadoPago)) {
        throw new BusinessError('El estado de pago debe ser pagado, pendiente o exento');
      }

      const paymentMethod = String(body?.paymentMethod || body?.formaPago || '').trim();
      if (estadoPago === 'pagado' && !VALID_PAYMENT_METHODS.includes(paymentMethod)) {
        throw new BusinessError('La forma de pago debe ser Efectivo o Transferencia');
      }

      const uso_sistema = USO_SISTEMA_BY_TIPO[tipoPase][esSocio ? 'socio' : 'noSocio'];
      const precio = await findPrecioVigenteByUsoSistema({ clubId, uso_sistema, date: fecha, session });
      const precioSugeridoSnapshot = precio?.monto ?? null;

      // Autoescaneo del socio: una visita diaria que cae fuera de los pases de su
      // plan de clases genera deuda, así que se pide confirmación antes de cargarla.
      let motivoExento = '';
      if (body?.autoescaneo && socio && esSocio && tipoPase === 'diario' && estadoPago === 'pendiente') {
        const pasesSemana = await pasesIncluidosSemana({ clubId, socioId: socio._id, fecha, session });
        const { restantes } = pasesSemana;
        if (restantes > 0) {
          estadoPago = 'exento';
          motivoExento = MOTIVO_EXENTO_PLAN_CLASES;
        } else if (!body?.confirmarDeuda) {
          throw new BusinessError(
            'Esta visita genera una deuda. Confirmá para continuar.',
            409,
            { requiereConfirmacion: true, monto: precioSugeridoSnapshot, pasesSemana },
          );
        }
      }
      const montoManual = body?.amount != null || body?.monto != null;
      const monto = montoManual ? Number(body.amount ?? body.monto) : precioSugeridoSnapshot;

      if (estadoPago === 'pagado' && !montoManual && monto == null) {
        // Sin monto y sin precio vigente (#317): nombrar el pase y el mes.
        const etiqueta = await Etiqueta.findOne({ clubId, uso_sistema, active: true }).lean();
        const periodo = periodoDeFecha(fecha);
        throw new BusinessError(
          mensajePrecioNoVigente({ etiquetaNombre: etiqueta?.nombre, periodo }),
          400,
          detallePrecioNoVigente({ etiqueta, periodo }),
        );
      }

      if (estadoPago === 'pagado' && (!Number.isFinite(monto) || monto <= 0)) {
        throw new BusinessError('El pago necesita un monto mayor que cero');
      }

      if (estadoPago !== 'pagado' && body?.amount != null && (!Number.isFinite(monto) || monto < 0)) {
        throw new BusinessError('El monto debe ser válido');
      }

      const actor = user?.email || user?.id;
      const registro = new Asistencia({
        clubId,
        tipo: 'muro_libre',
        socioId: socio?._id ?? null,
        diaCheckin: socio ? buildDiaCheckin(fecha) : null,
        // scannedBy/checkinMethod son parámetros de la función (calculados
        // por el backend en checkinMuroLibre.handler.js según cómo se
        // identificó al socio: QR/DNI/SELF) — no vienen del body, que es
        // input del cliente sin sanitizar (appcarc-backend#152).
        scannedBy: scannedBy || null,
        checkinMethod: checkinMethod || 'MANUAL',
        nombre,
        apellido,
        dni,
        esSocio,
        tipoPase,
        estadoPago,
        monto: estadoPago === 'pagado' ? monto : 0,
        precioSugeridoSnapshot,
        uso_sistema,
        fecha,
        periodo: tipoPase === 'mensual' ? periodoDeFecha(fecha) : '',
        formaPago: estadoPago === 'pagado' ? paymentMethod : 'Sin pago',
        advertencias,
        observaciones: motivoExento
          ? [String(body?.observaciones || '').trim(), 'Incluido por plan de clases'].filter(Boolean).join(' — ')
          : String(body?.observaciones || '').trim(),
        motivoExento,
        enviarComprobanteWp: Boolean(body?.enviarComprobanteWp),
        createdBy: actor,
        updatedBy: actor,
      });
      await registro.save({ session });

      let movimiento = null;
      if (estadoPago === 'pagado') {
        movimiento = await crearMovimientoDePago({
          clubId,
          userId: user.id,
          actor,
          socioId: socio?._id ?? null,
          socioNombre: `${nombre}${apellido ? ` ${apellido}` : ''}`,
          amount: monto,
          concept: tipoPase === 'mensual' ? 'Muro libre mensual' : 'Muro libre diario',
          paymentMethod,
          description: `${esSocio ? 'Socio' : 'No socio'} - ${tipoPase}`,
          date: fecha,
          sourceType: 'muro_libre',
          sourceId: registro._id,
          sourceModel: 'Asistencia',
          session,
        });

        registro.movimientoId = movimiento._id;
        registro.updatedBy = actor;
        await registro.save({ session });
      }

      // Alta de la suscripción y de la cuota real del pase mensual, para que
      // quede reflejado en /api/socios/:id/deuda y no se vuelva a pedir pago
      // si el socio entra otra vez en el mismo período.
      if (tipoPase === 'mensual' && !cuotaMensualVigente) {
        if (suscripcionMensual && suscripcionMensual.fechaDesde > periodoMensual) {
          // Tenía el pase programado para más adelante y hoy entra con pase
          // mensual: se adelanta el inicio a este período en vez de duplicarlo.
          suscripcionMensual.fechaDesde = periodoMensual;
          suscripcionMensual.updatedBy = actor;
          await suscripcionMensual.save({ session });
        }

        if (!suscripcionMensual) {
          suscripcionMensual = new Suscripcion({
            clubId,
            socioId: socio._id,
            etiquetaId: etiquetaMensual._id,
            fechaDesde: periodoMensual,
            active: true,
            createdBy: actor,
            updatedBy: actor,
          });
          await suscripcionMensual.save({ session });
        }

        if (estadoPago === 'pagado') {
          const cuotaMensual = new Cuota({
            clubId,
            socioId: socio._id,
            suscripcionId: suscripcionMensual._id,
            etiquetaId: etiquetaMensual._id,
            periodo: periodoMensual,
            estado: 'pagada',
            montoEsperadoSnapshot: precioSugeridoSnapshot ?? monto,
            montoPagadoSnapshot: monto,
            precioSugeridoSnapshot,
            paymentMethod,
            fechaPago: fecha,
            movimientoId: movimiento?._id ?? null,
            createdBy: actor,
            updatedBy: actor,
          });
          await cuotaMensual.save({ session });
        }
      }

      result = { registro, movimiento };
    });

    return { ...result, advertencias };
  } catch (error) {
    const esDuplicadoCheckin = error?.code === 11000
      && (error?.keyPattern?.diaCheckin !== undefined || /diaCheckin/.test(error?.message || ''));
    if (esDuplicadoCheckin) {
      throw new BusinessError(`${nombre} ${apellido} ya registró asistencia en muro libre hoy`, 409);
    }
    throw error;
  } finally {
    session.endSession();
  }
};

// Revierte la Cuota 'pagada' que un check-in de pase mensual generó como
// efecto colateral (ver arriba, líneas 311-344) — sin esto, anular el
// check-in (o el Movimiento asociado) revierte la plata pero deja al socio
// figurando "al día" el resto del período, y puede volver a entrar gratis
// (appcarc-backend#153). Se ubica por movimientoId (1:1 con el check-in que
// la generó) en vez de necesitar un cuotaId nuevo en Asistencia — mismo
// criterio que anularCobroConTrazabilidad usa con cobroId. No-op si no hay
// ninguna Cuota con ese movimientoId (pase diario, o mensual que nunca se
// pagó). Compartida entre deleteMuroLibre.handler.js (anular el check-in
// directamente) y deleteMovimiento.handler.js (borrar el Movimiento
// asociado) — mismas dos puertas que ya se desincronizaron una vez con
// CargoPuntual/Asistencia en appcarc-backend#137.
export const anularCuotaMuroLibreMensual = async ({ clubId, movimientoId, actor, session }) => {
  if (!movimientoId) return;
  await Cuota.updateMany(
    { clubId, movimientoId },
    { estado: 'anulada', updatedBy: actor },
    { session },
  );
};

export { BusinessError };
