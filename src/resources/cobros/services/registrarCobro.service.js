import mongoose from 'mongoose';
import Socio from '../../socios/models/Socio.js';
import Cuota from '../../cuotas/models/Cuota.js';
import Suscripcion from '../../suscripciones/models/Suscripcion.js';
import CargoPuntual from '../../cargosPuntuales/models/CargoPuntual.js';
import Asistencia from '../../asistencias/models/Asistencia.js';
import Etiqueta from '../../etiquetas/models/Etiqueta.js';
import Cobro from '../models/Cobro.js';
import { crearMovimientoDePago } from '../../movimientos/services/crearMovimientoDePago.service.js';
import { findPrecioVigente } from '../../cuotas/services/findPrecioVigente.service.js';
import { resolverPreciosPorPeriodo } from '../../cuotas/services/resolverPreciosPorPeriodo.service.js';
import { fechaCalendarioArgentina, periodoDeFecha } from '../../../services/fechaArgentina.js';
import { aplicarPagoConSaldo } from '../../../services/pagoConSaldo.service.js';
import { detallePrecioNoVigente, mensajePrecioNoVigente } from '../../../services/precioNoVigente.js';

// 'MercadoPago' solo lo asigna el webhook al confirmar un pago online — nunca
// lo elige un humano a mano (RegistrarCobroScreen solo ofrece Efectivo/Transferencia).
const VALID_PAYMENT_METHODS = ['Efectivo', 'Transferencia', 'MercadoPago'];
const PERIODO_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

// Cobrar a precio de cada mes (appcarc-backend#285). El permiso
// cobros:precio-historico lo exige un middleware de la ruta solo cuando
// body.modoPrecio === 'historico' (ver routes.js). Por eso acá NO se normaliza
// (ni trim ni minúsculas): un 'Historico ' que pasara el middleware como
// "no histórico" y se tratara como histórico acá salteaba el permiso.
const MODOS_PRECIO = ['actual', 'historico'];
const MIN_CARACTERES_MOTIVO = 10;

class BusinessError extends Error {
  constructor(message, status = 400, data = null) {
    super(message);
    this.name = 'BusinessError';
    this.status = status;
    this.data = data;
  }
}

// Sin importe y sin precio vigente (#317): nombra la cuota y el período, y
// manda code PRECIO_NO_VIGENTE para que el cliente muestre su propio aviso.
const precioNoVigenteError = async ({ clubId, etiquetaId, etiqueta = null, periodo, session }) => {
  const etq = etiqueta
    ?? await Etiqueta.findOne({ _id: etiquetaId, clubId }).select('nombre').session(session).lean();
  return new BusinessError(
    mensajePrecioNoVigente({ etiquetaNombre: etq?.nombre, periodo }),
    400,
    detallePrecioNoVigente({ etiqueta: { _id: etiquetaId ?? etq?._id, nombre: etq?.nombre }, periodo }),
  );
};

const addMonthsToPeriodo = (periodo, monthsToAdd) => {
  const [year, month] = periodo.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + monthsToAdd, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

// Período en hora argentina (appcarc-backend#283): con getUTC* un cobro o una
// visita del último día del mes después de las 21 hs caía en el mes siguiente.
const buildPeriodoFromFecha = (fecha) => periodoDeFecha(new Date(fecha));

// Tope defensivo: cinco años de cuotas mensuales por item. Sin esto, un
// `cantidad` (o `periodos`) desmedido hace que Array.from intente crear un
// array gigante dentro de la transacción de Mongo (DoS de bajo esfuerzo).
const MAX_PERIODOS_POR_ITEM = 60;

// Registrar Cobro permite adelantar meses futuros de una suscripción abierta
// (pagar por adelantado) — calcularDeuda no los expone como deuda, pero acá
// no hay ninguna razón de negocio para rechazarlos. Sí conviene un tope
// generoso para atajar errores de carga (ej. tipear "2030-01" por accidente),
// no para limitar el adelanto legítimo.
const MAX_MESES_ADELANTO = 24;

const getPeriodosFromItem = (item, index, hoyPeriodo) => {
  let periodos;

  if (Array.isArray(item?.periodos) && item.periodos.length) {
    if (item.periodos.length > MAX_PERIODOS_POR_ITEM) {
      throw new BusinessError(`El item ${index + 1} no puede tener más de ${MAX_PERIODOS_POR_ITEM} períodos`);
    }
    periodos = item.periodos.map((p) => String(p || '').trim());
    const invalid = periodos.find((p) => !PERIODO_PATTERN.test(p));
    if (invalid) throw new BusinessError(`El item ${index + 1} contiene un período inválido`);
  } else {
    const periodoInicial = String(item?.periodoDesde || item?.periodo || '').trim();
    if (!PERIODO_PATTERN.test(periodoInicial)) {
      throw new BusinessError(`El item ${index + 1} debe usar periodo con formato YYYY-MM`);
    }

    const cantidad = item?.cantidad == null ? 1 : Number(item.cantidad);
    if (!Number.isInteger(cantidad) || cantidad <= 0 || cantidad > MAX_PERIODOS_POR_ITEM) {
      throw new BusinessError(`El item ${index + 1} debe tener una cantidad entera entre 1 y ${MAX_PERIODOS_POR_ITEM}`);
    }

    periodos = Array.from({ length: cantidad }, (_, offset) => addMonthsToPeriodo(periodoInicial, offset));
  }

  const tope = addMonthsToPeriodo(hoyPeriodo, MAX_MESES_ADELANTO);
  const muyLejos = periodos.find((p) => p > tope);
  if (muyLejos) {
    throw new BusinessError(`El item ${index + 1} tiene un período (${muyLejos}) demasiado lejano — máximo ${MAX_MESES_ADELANTO} meses de adelanto`);
  }

  return periodos;
};

const normalizeItem = async ({ item, index, clubId, date, precioCache, precioHistorico = false, session = null }) => {
  const socioId = String(item?.socioId || '').trim();
  const suscripcionId = String(item?.suscripcionId || '').trim();
  const cargoPuntualId = String(item?.cargoPuntualId || '').trim();
  const muroLibrePendiente = Boolean(item?.muroLibrePendiente);
  const amount = item?.amount == null ? null : Number(item.amount);
  let precioSugeridoSnapshot = item?.precioSugeridoSnapshot == null
    ? null
    : Number(item.precioSugeridoSnapshot);

  if (!socioId) throw new BusinessError(`El item ${index + 1} debe indicar socioId`);
  if (!suscripcionId && !cargoPuntualId && !muroLibrePendiente) {
    throw new BusinessError(`El item ${index + 1} debe indicar suscripcionId, cargoPuntualId o muroLibrePendiente`);
  }

  if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) {
    throw new BusinessError(`El item ${index + 1} debe tener un importe mayor que cero`);
  }

  if (precioSugeridoSnapshot !== null && (!Number.isFinite(precioSugeridoSnapshot) || precioSugeridoSnapshot < 0)) {
    throw new BusinessError(`El item ${index + 1} tiene un precio sugerido inválido`);
  }

  if (cargoPuntualId) {
    const cargo = await CargoPuntual.findOne({ _id: cargoPuntualId, socioId, clubId, active: true }).lean();
    if (!cargo) {
      throw new BusinessError(`Cargo puntual ${cargoPuntualId} no encontrado para el socio ${socioId}`, 404);
    }
    // 'parcial' también es cobrable (el resto del saldo) — solo 'pagada' y
    // 'anulada' están cerrados de verdad.
    if (!['pendiente', 'parcial'].includes(cargo.estado)) {
      throw new BusinessError(`El cargo puntual "${cargo.description}" del socio ${socioId} ya está ${cargo.estado}`, 409);
    }

    const unitAmount = amount ?? cargo.montoEsperadoSnapshot;
    if (!Number.isFinite(unitAmount) || unitAmount < 0) {
      throw new BusinessError(`El item ${index + 1} necesita un importe válido`);
    }

    return [{
      socioId,
      suscripcionId: null,
      cargoPuntualId,
      etiquetaId: String(cargo.etiquetaId),
      periodo: cargo.periodo,
      amount: unitAmount,
      // Flag explícito, nunca inferido comparando amount contra lo esperado
      // (appcarc-backend#168) — sin esto, cualquier monto cierra el cargo
      // como pagado, igual que siempre (ajuste de precio).
      esPagoParcial: Boolean(item?.esPagoParcial),
      precioSugeridoSnapshot: precioSugeridoSnapshot ?? cargo.precioSugeridoSnapshot,
      description: String(item?.description || '').trim() || cargo.description,
    }];
  }

  if (muroLibrePendiente) {
    const pendientes = await Asistencia.find({
      clubId,
      socioId,
      tipo: 'muro_libre',
      tipoPase: 'diario',
      active: true,
      estadoPago: 'pendiente',
    }).sort({ fecha: 1 }).session(session);

    if (!pendientes.length) {
      throw new BusinessError(`El socio ${socioId} no tiene visitas de Muro Libre pendientes`, 404);
    }

    // asistenciaIds: visitas puntuales elegidas a mano (ej. "quiero pagar
    // estas 2, no las 4 más viejas") — si no vienen, se mantiene el
    // comportamiento viejo de "las cantidad más viejas primero", para no
    // romper clientes que todavía mandan solo cantidad.
    let seleccionadas;
    if (Array.isArray(item?.asistenciaIds)) {
      const idsPedidos = item.asistenciaIds.map(String);
      const idsSet = new Set(idsPedidos);
      seleccionadas = pendientes.filter((a) => idsSet.has(String(a._id)));
      if (seleccionadas.length !== idsSet.size) {
        throw new BusinessError(`El item ${index + 1} incluye visitas de Muro Libre que ya no están pendientes`, 404);
      }
    } else {
      const cantidad = item?.cantidad == null ? pendientes.length : Number(item.cantidad);
      if (!Number.isInteger(cantidad) || cantidad <= 0) {
        throw new BusinessError(`El item ${index + 1} debe tener una cantidad entera mayor que cero`);
      }
      seleccionadas = pendientes.slice(0, Math.min(cantidad, pendientes.length));
    }

    const usoSistema = seleccionadas[0].esSocio ? 'muro_libre_diario_socio' : 'muro_libre_diario_no_socio';
    const etiqueta = await Etiqueta.findOne({ clubId, uso_sistema: usoSistema, active: true }).session(session).lean();
    if (!etiqueta) {
      throw new BusinessError('No hay una etiqueta de Muro Libre Diario configurada para este club');
    }

    // Secuencial: las queries comparten la sesión (ver registrarCobro).
    const normalizados = [];
    for (const asistencia of seleccionadas) {
      // Visita registrada sin precio (no había uno vigente ese día): se toma
      // el de la fecha de la visita, así cargarlo después alcanza para
      // cobrarla (#317).
      let visitAmount = amount ?? asistencia.precioSugeridoSnapshot;
      if (visitAmount == null) {
        const precio = await findPrecioVigente({ clubId, etiquetaId: etiqueta._id, date: asistencia.fecha, session });
        visitAmount = precio?.monto ?? null;
      }
      if (!Number.isFinite(visitAmount) || visitAmount < 0) {
        throw await precioNoVigenteError({ clubId, etiqueta, periodo: buildPeriodoFromFecha(asistencia.fecha), session });
      }

      normalizados.push({
        socioId,
        suscripcionId: null,
        cargoPuntualId: null,
        asistenciaId: String(asistencia._id),
        etiquetaId: String(etiqueta._id),
        periodo: buildPeriodoFromFecha(asistencia.fecha),
        amount: visitAmount,
        precioSugeridoSnapshot: asistencia.precioSugeridoSnapshot,
        description: String(item?.description || '').trim() || 'Muro Libre - visita pendiente',
      });
    }
    return normalizados;
  }

  const periodos = getPeriodosFromItem(item, index, buildPeriodoFromFecha(date));

  // Buscar suscripcion para obtener etiquetaId
  const suscripcion = await Suscripcion.findOne({
    _id: suscripcionId,
    socioId,
    clubId,
    active: true,
  }).lean();

  if (!suscripcion) {
    throw new BusinessError(`Suscripción ${suscripcionId} no encontrada para el socio ${socioId}`, 404);
  }

  const etiquetaId = String(suscripcion.etiquetaId);
  const description = String(item?.description || '').trim();

  if (precioHistorico) {
    return normalizeItemPrecioHistorico({
      item, index, clubId, date, precioCache, session, socioId, suscripcionId, etiquetaId, periodos, description,
    });
  }

  if (precioSugeridoSnapshot === null && amount === null) {
    if (!precioCache.has(etiquetaId)) {
      precioCache.set(etiquetaId, await findPrecioVigente({ clubId, etiquetaId, date, session }));
    }
    const precio = precioCache.get(etiquetaId);
    precioSugeridoSnapshot = precio?.monto ?? null;
  }

  const unitAmount = amount ?? precioSugeridoSnapshot;
  if (unitAmount == null) {
    throw await precioNoVigenteError({ clubId, etiquetaId, periodo: periodoDeFecha(date), session });
  }
  if (!Number.isFinite(unitAmount) || unitAmount < 0) {
    throw new BusinessError(`El item ${index + 1} necesita un importe válido`);
  }

  // Cuando el front manda `amount`, es el TOTAL a repartir entre todos los
  // períodos de este item (ver RegistrarCobroScreen: "Monto total" ya viene
  // multiplicado por la cantidad de meses) — hay que dividirlo entre la
  // cantidad de períodos para obtener el importe por mes. Si no vino `amount`,
  // `unitAmount` ya es el precio vigente por mes y se aplica tal cual.
  const amountPorPeriodo = amount != null ? amount / periodos.length : unitAmount;

  return periodos.map((periodo) => ({
    socioId,
    suscripcionId,
    cargoPuntualId: null,
    etiquetaId,
    periodo,
    amount: amountPorPeriodo,
    precioSugeridoSnapshot,
    description,
  }));
};

// Modo precio histórico (#285): el servidor calcula el importe de cada mes con
// el precio que regía entonces; el cliente no puede mandar el suyo. El precio
// de hoy queda como precioSugeridoSnapshot (se ignora el que mande el
// cliente), así se ve la diferencia contra lo cobrado.
const normalizeItemPrecioHistorico = async ({
  item, index, clubId, date, precioCache, session, socioId, suscripcionId, etiquetaId, periodos, description,
}) => {
  if (item?.amount != null) {
    throw new BusinessError(`El item ${index + 1} no puede llevar importe: al cobrar a precio de cada mes, el importe lo calcula el sistema`);
  }

  const montos = await resolverPreciosPorPeriodo({ clubId, etiquetaId, periodos, session });
  const sinPrecio = periodos.find((periodo) => montos.get(periodo) === null);
  if (sinPrecio) {
    throw await precioNoVigenteError({ clubId, etiquetaId, periodo: sinPrecio, session });
  }

  if (!precioCache.has(etiquetaId)) {
    precioCache.set(etiquetaId, await findPrecioVigente({ clubId, etiquetaId, date, session }));
  }
  const precioSugeridoSnapshot = precioCache.get(etiquetaId)?.monto ?? null;

  return periodos.map((periodo) => ({
    socioId,
    suscripcionId,
    cargoPuntualId: null,
    etiquetaId,
    periodo,
    amount: montos.get(periodo),
    precioSugeridoSnapshot,
    description,
  }));
};

// Valida modoPrecio y motivo del body. `precioHistoricoHeredado` NO viene del
// body: lo pasa cambiarFormaPagoCobro al rehacer un cobro que ya fue
// histórico, para conservar modo y motivo con los importes tal cual (sin
// recalcular ni volver a pedir el permiso).
const resolverModoPrecio = (body, precioHistoricoHeredado) => {
  if (precioHistoricoHeredado) {
    return { modoPrecio: 'historico', motivoPrecioHistorico: precioHistoricoHeredado.motivo, recalcular: false };
  }

  const modoPrecio = body?.modoPrecio ?? 'actual';
  if (!MODOS_PRECIO.includes(modoPrecio)) {
    throw new BusinessError('El modo de precio debe ser "actual" o "historico"');
  }
  if (modoPrecio === 'actual') return { modoPrecio, motivoPrecioHistorico: null, recalcular: false };

  const motivo = typeof body?.motivoPrecioHistorico === 'string' ? body.motivoPrecioHistorico.trim() : '';
  if (motivo.replace(/\s/g, '').length < MIN_CARACTERES_MOTIVO) {
    throw new BusinessError(`Para cobrar a precio de cada mes hay que indicar el motivo (mínimo ${MIN_CARACTERES_MOTIVO} caracteres)`);
  }
  return { modoPrecio, motivoPrecioHistorico: motivo, recalcular: true };
};

const buildItemKey = (item) => {
  if (item.cargoPuntualId) return `cargo:${item.cargoPuntualId}`;
  if (item.asistenciaId) return `asistencia:${item.asistenciaId}`;
  return `${item.socioId}:${item.suscripcionId}:${item.periodo}`;
};

// El Movimiento de un Cobro decía siempre 'Cobro de cuotas', sin importar qué
// hubiera realmente en el carrito — un cargo puntual (ej. remera) o una
// visita de Muro Libre pagados por esta vía terminaban viéndose en
// Movimientos como "pago de cuotas". Deriva el concept de los items reales:
// todos del mismo tipo → su label; un solo cargo puntual → su descripción
// puntual (ej. "Remera adulto"); mixto → un label genérico que al menos no
// miente sobre qué es.
const resolverConceptoCobro = (items) => {
  const esCuota = (item) => Boolean(item.suscripcionId);
  const esCargo = (item) => Boolean(item.cargoPuntualId);
  const esMuroLibre = (item) => Boolean(item.asistenciaId);

  if (items.every(esCuota)) return 'Cobro de cuotas';
  if (items.every(esMuroLibre)) return 'Muro libre diario';

  if (items.every(esCargo)) {
    if (items.length === 1) return items[0].description || 'Cargo puntual';
    const descripciones = [...new Set(items.map((item) => item.description))];
    return descripciones.length === 1
      ? descripciones[0]
      : `Cobro de cargos puntuales (${items.length})`;
  }

  return `Cobro combinado (${items.length} ítem${items.length === 1 ? '' : 's'})`;
};

export const registrarCobro = async ({ clubId, user, body, precioHistoricoHeredado = null }) => {
  if (!clubId) throw new BusinessError('No se pudo determinar el club del usuario', 401);

  const { modoPrecio, motivoPrecioHistorico, recalcular } = resolverModoPrecio(body, precioHistoricoHeredado);

  const date = body?.date ? new Date(body.date) : new Date();
  if (Number.isNaN(date.getTime())) throw new BusinessError('La fecha del cobro es inválida');
  // Compara por día calendario en horario argentino (UTC-3), no por timestamp exacto:
  // de lo contrario "hoy" se rechazaría como futuro mientras el mediodía AR aún no
  // ocurrió en UTC (el servidor corre en UTC). appcarc-backend#160: reusa
  // fechaArgentina.js en vez de reimplementar el offset a mano.
  if (fechaCalendarioArgentina(date) > fechaCalendarioArgentina(new Date())) {
    throw new BusinessError('La fecha del cobro no puede ser futura');
  }

  const session = await mongoose.startSession();
  try {
    let result = null;

    await session.withTransaction(async () => {
      const precioCache = new Map();
      // Secuencial, no Promise.all: normalizeItem hace queries con .session(session)
      // y Mongo no soporta más de una operación en vuelo por ClientSession a la vez.
      const items = [];
      if (Array.isArray(body?.items)) {
        for (let index = 0; index < body.items.length; index++) {
          const normalized = await normalizeItem({
            item: body.items[index], index, clubId, date, precioCache, session,
            precioHistorico: recalcular,
          });
          items.push(...normalized);
        }
      }

      if (!items.length) throw new BusinessError('El cobro debe incluir al menos un ítem');

      const duplicated = items.find((item, index) => (
        items.findIndex((c) => buildItemKey(c) === buildItemKey(item)) !== index
      ));
      if (duplicated) {
        throw new BusinessError(duplicated.cargoPuntualId
          ? `El cobro incluye el cargo puntual ${duplicated.cargoPuntualId} duplicado`
          : `El cobro incluye una cuota duplicada para socio ${duplicated.socioId}, suscripción ${duplicated.suscripcionId}, ${duplicated.periodo}`);
      }

      const responsable = String(user?.email || user?.id || '').trim();
      if (!responsable) throw new BusinessError('No se pudo determinar el responsable del cobro');

      const paymentMethod = String(body?.paymentMethod || '').trim();
      if (!VALID_PAYMENT_METHODS.includes(paymentMethod)) {
        throw new BusinessError('La forma de pago debe ser Efectivo o Transferencia');
      }

      const description = String(body?.description || '').trim();

      const socioIds = [...new Set(items.map((item) => item.socioId))];
      const socios = await Socio.find({ _id: { $in: socioIds }, clubId, active: true }).session(session);
      const sociosEncontrados = new Set(socios.map((s) => String(s._id)));
      const socioFaltante = socioIds.find((id) => !sociosEncontrados.has(id));
      if (socioFaltante) {
        throw new BusinessError(`El socio ${socioFaltante} no existe, está inactivo o pertenece a otro club`, 404);
      }

      const itemsSuscripcion = items.filter((item) => item.suscripcionId);
      const itemsCargoPuntual = items.filter((item) => item.cargoPuntualId);
      const itemsAsistencia = items.filter((item) => item.asistenciaId);

      if (modoPrecio === 'historico' && !itemsSuscripcion.length) {
        throw new BusinessError('El precio de cada mes solo se aplica a cuotas de suscripción, y este cobro no incluye ninguna');
      }

      const cuotaFilters = itemsSuscripcion.map((item) => ({
        clubId,
        socioId: item.socioId,
        suscripcionId: item.suscripcionId,
        periodo: item.periodo,
        active: true,
      }));

      const existingCuotas = cuotaFilters.length
        ? await Cuota.find({ $or: cuotaFilters }).session(session)
        : [];
      const cuotaPagada = existingCuotas.find((c) => c.estado === 'pagada');
      if (cuotaPagada) {
        throw new BusinessError(`La cuota ${cuotaPagada.periodo} de la suscripción ${cuotaPagada.suscripcionId} del socio ${cuotaPagada.socioId} ya está pagada`, 409);
      }

      const cargosPuntualesDb = itemsCargoPuntual.length
        ? await CargoPuntual.find({
          _id: { $in: itemsCargoPuntual.map((item) => item.cargoPuntualId) },
          clubId,
          active: true,
        }).session(session)
        : [];
      const cargoYaResuelto = cargosPuntualesDb.find((c) => !['pendiente', 'parcial'].includes(c.estado));
      if (cargoYaResuelto) {
        throw new BusinessError(`El cargo puntual "${cargoYaResuelto.description}" ya está ${cargoYaResuelto.estado}`, 409);
      }

      const asistenciasDb = itemsAsistencia.length
        ? await Asistencia.find({
          _id: { $in: itemsAsistencia.map((item) => item.asistenciaId) },
          clubId,
          active: true,
        }).session(session)
        : [];
      const asistenciaYaResuelta = asistenciasDb.find((a) => a.estadoPago !== 'pendiente');
      if (asistenciaYaResuelta) {
        throw new BusinessError(`La visita de Muro Libre del ${asistenciaYaResuelta.fecha.toISOString().slice(0, 10)} del socio ${asistenciaYaResuelta.socioId} ya está ${asistenciaYaResuelta.estadoPago}`, 409);
      }

      const totalAmount = items.reduce((total, item) => total + item.amount, 0);
      const actor = user?.email || user?.id;

      const socioUnico = socioIds.length === 1
        ? socios.find((s) => String(s._id) === socioIds[0])
        : null;

      const cobro = new Cobro({
        clubId,
        responsable,
        paymentMethod,
        totalAmount,
        description,
        date,
        items,
        modoPrecio,
        motivoPrecioHistorico,
        createdBy: actor,
        updatedBy: actor,
      });
      await cobro.save({ session });

      const movimiento = await crearMovimientoDePago({
        clubId,
        userId: user.id,
        actor,
        socioId: socioUnico?._id ?? null,
        socioNombre: socioUnico ? `${socioUnico.nombre}${socioUnico.apellido ? ` ${socioUnico.apellido}` : ''}` : '',
        amount: totalAmount,
        concept: resolverConceptoCobro(items),
        paymentMethod,
        description: description || `Cobro con ${items.length} ítem${items.length === 1 ? '' : 's'}`,
        date,
        sourceType: 'cobro',
        sourceId: cobro._id,
        sourceModel: 'Cobro',
        session,
      });

      const cuotas = [];
      for (const item of itemsSuscripcion) {
        const existing = existingCuotas.find((c) => (
          String(c.socioId) === item.socioId
          && String(c.suscripcionId) === item.suscripcionId
          && c.periodo === item.periodo
        ));

        const cuotaData = {
          clubId,
          socioId: item.socioId,
          suscripcionId: item.suscripcionId,
          etiquetaId: item.etiquetaId,
          periodo: item.periodo,
          estado: 'pagada',
          montoEsperadoSnapshot: item.precioSugeridoSnapshot ?? item.amount,
          montoPagadoSnapshot: item.amount,
          precioSugeridoSnapshot: item.precioSugeridoSnapshot,
          cobroId: cobro._id,
          movimientoId: movimiento._id,
          fechaPago: date,
          paymentMethod,
          description: item.description,
          updatedBy: actor,
          active: true,
        };

        if (existing) {
          Object.assign(existing, cuotaData);
          await existing.save({ session });
          cuotas.push(existing);
        } else {
          const cuota = new Cuota({ ...cuotaData, createdBy: actor });
          await cuota.save({ session });
          cuotas.push(cuota);
        }
      }

      const cargosPuntuales = [];
      for (const item of itemsCargoPuntual) {
        const cargo = cargosPuntualesDb.find((c) => String(c._id) === item.cargoPuntualId);

        aplicarPagoConSaldo({
          doc: cargo,
          monto: item.amount,
          fecha: date,
          paymentMethod,
          movimientoId: movimiento._id,
          cobroId: cobro._id,
          esPagoParcial: item.esPagoParcial,
          actor,
        });
        // Espejo del ÚLTIMO pago — no forma parte del contrato compartido de
        // aplicarPagoConSaldo (EventoParticipante no lo tiene), es propio de
        // CargoPuntual.
        cargo.paymentMethod = paymentMethod;
        cargo.fechaPago = date;
        cargo.cobroId = cobro._id;
        cargo.movimientoId = movimiento._id;
        await cargo.save({ session });
        cargosPuntuales.push(cargo);
      }

      const asistencias = [];
      for (const item of itemsAsistencia) {
        const asistencia = asistenciasDb.find((a) => String(a._id) === item.asistenciaId);
        asistencia.estadoPago = 'pagado';
        asistencia.monto = item.amount;
        asistencia.formaPago = paymentMethod;
        asistencia.cobroId = cobro._id;
        asistencia.movimientoId = movimiento._id;
        asistencia.updatedBy = actor;
        await asistencia.save({ session });
        asistencias.push(asistencia);
      }

      cobro.movimientoId = movimiento._id;
      cobro.updatedBy = actor;
      await cobro.save({ session });

      result = { cobro, movimiento, cuotas, cargosPuntuales, asistencias };
    });

    return result;
  } finally {
    session.endSession();
  }
};

export { BusinessError };
