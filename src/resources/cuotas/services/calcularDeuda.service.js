import Cuota from '../models/Cuota.js';
import Suscripcion from '../../suscripciones/models/Suscripcion.js';
import Asistencia from '../../asistencias/models/Asistencia.js';
import CargoPuntual from '../../cargosPuntuales/models/CargoPuntual.js';
import EventoParticipante from '../../eventos/models/EventoParticipante.js';
import { findPrecioVigente } from './findPrecioVigente.service.js';
import { resolverPreciosPorPeriodo } from './resolverPreciosPorPeriodo.service.js';
import { periodoDeFecha } from '../../../services/fechaArgentina.js';

// Mes en curso en hora argentina: el container corre en UTC, y con la hora
// del proceso el último día del mes desde las 21 hs ya contaba el mes
// siguiente como adeudado (appcarc-backend#283).
const periodoHoy = () => periodoDeFecha(new Date());

const addOneMonth = (periodo) => {
  const [year, month] = periodo.split('-').map(Number);
  const d = new Date(Date.UTC(year, month, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

const expandPeriodos = (desde, hasta) => {
  const periodos = [];
  let current = desde;
  while (current <= hasta) {
    periodos.push(current);
    current = addOneMonth(current);
    if (periodos.length > 600) break;
  }
  return periodos;
};


/**
 * Cargos que no son mensuales/por suscripción: pases DIARIOS de Muro Libre
 * pagados "pendiente" en el momento del check-in. Los pases MENSUALES no
 * entran acá — desde que el check-in mensual suscribe al socio (ver
 * registrarMuroLibre.service.js), esa deuda ya la cubre calcularDeudaSuscripciones
 * a través de la Suscripcion real. Se acumulan en un array genérico de "otros
 * cargos" para que a futuro cualquier otro cobro por evento/uso (salidas,
 * alquileres, etc.) se sume acá con el mismo formato, sin volver a cambiar el
 * contrato de /api/socios/:id/deuda.
 */
const calcularCargoMuroLibre = async ({ socioId, clubId }) => {
  const pendientes = await Asistencia.find({
    clubId,
    socioId,
    tipo: 'muro_libre',
    tipoPase: 'diario',
    active: true,
    estadoPago: 'pendiente',
  }).select('fecha precioSugeridoSnapshot tipoPase').sort({ fecha: 1 }).lean();

  if (!pendientes.length) return null;

  return {
    tipo: 'muro_libre',
    nombre: 'Muro Libre',
    cantidadPendiente: pendientes.length,
    unidadPendiente: 'visita',
    // fechas: se mantiene por compatibilidad con clientes viejos — el
    // front nuevo usa "visitas" para poder elegir puntualmente cuáles
    // pagar en vez de solo una cantidad (appcarc-mobile: pedido de Nico).
    fechas: pendientes.map((p) => p.fecha),
    visitas: pendientes.map((p) => ({
      asistenciaId: String(p._id),
      fecha: p.fecha,
      monto: p.precioSugeridoSnapshot ?? null,
    })),
    totalDeuda: pendientes.reduce((sum, p) => sum + (p.precioSugeridoSnapshot ?? 0), 0),
  };
};

/**
 * Cargos puntuales atribuidos manualmente desde secretaría (viajes, inscripciones,
 * etc. — ver src/resources/cargosPuntuales). A diferencia de calcularCargoMuroLibre,
 * cada uno se muestra como una entrada individual (no agregada) porque cada cargo
 * puntual es un concepto distinto con su propio importe.
 */
const calcularCargosPuntuales = async ({ socioId, clubId }) => {
  // 'parcial': ya se cobró una seña, queda el saldo real pendiente — se
  // muestra igual que un pendiente normal, pero por el SALDO restante, no
  // por el monto original (appcarc-backend#168).
  const pendientes = await CargoPuntual.find({
    clubId,
    socioId,
    estado: { $in: ['pendiente', 'parcial'] },
    active: true,
  })
    .populate('etiquetaId', 'nombre')
    .sort({ createdAt: 1 })
    .lean();

  return pendientes.map((c) => ({
    tipo: 'cargo_puntual',
    cargoPuntualId: c._id,
    nombre: c.etiquetaId?.nombre ?? 'Cargo puntual',
    descripcion: c.description,
    totalDeuda: c.montoEsperadoSnapshot - (c.montoPagadoSnapshot || 0),
    estado: c.estado,
    montoPagado: c.montoPagadoSnapshot || 0,
  }));
};

/**
 * Eventos (viajes, cursos, ventas puntuales — appcarc-backend#173/#178) en
 * los que este socio es participante y todavía debe algo. Mismo criterio y
 * mismo shape que calcularCargosPuntuales (appcarc-backend#176): así el
 * botón "Enviar estado de cuotas" (que ya itera `otrosCargos` genérico) y
 * las pantallas de mobile/web que ya saben mostrar un `estado: 'parcial'`
 * (appcarc-backend#171) no necesitan tocarse para esto.
 */
const calcularEventosPendientes = async ({ socioId, clubId }) => {
  const pendientes = await EventoParticipante.find({
    clubId,
    socioId,
    estado: { $in: ['pendiente', 'parcial'] },
    active: true,
  })
    .populate('eventoId', 'nombre descripcion')
    .sort({ createdAt: 1 })
    .lean();

  return pendientes.map((p) => ({
    tipo: 'evento',
    eventoId: p.eventoId?._id ?? p.eventoId,
    // Necesario para poder cobrarlo desde Registrar Cobro (appcarc-backend#175
    // espera participanteId, no alcanza con el eventoId) — appCARC-mobile#141.
    participanteId: p._id,
    nombre: p.eventoId?.nombre ?? 'Evento',
    descripcion: p.eventoId?.descripcion || '',
    totalDeuda: p.montoEsperadoSnapshot - (p.montoPagadoSnapshot || 0),
    estado: p.estado,
    montoPagado: p.montoPagadoSnapshot || 0,
  }));
};

const calcularOtrosCargos = async ({ socioId, clubId }) => {
  const [muroLibre, cargosPuntuales, eventos] = await Promise.all([
    calcularCargoMuroLibre({ socioId, clubId }),
    calcularCargosPuntuales({ socioId, clubId }),
    calcularEventosPendientes({ socioId, clubId }),
  ]);

  return [muroLibre, ...cargosPuntuales, ...eventos].filter(Boolean);
};

/**
 * Cobrar a precio de cada mes (appcarc-backend#285): además del total al
 * precio de hoy (totalDeuda, que no cambia), cada deuda trae el precio que
 * regía en cada mes adeudado y la suma. Va después del recorte de tramos
 * superpuestos (R4b), así cada mes se valúa una sola vez, y con una consulta
 * de precios por etiqueta (no una por mes ni una por tramo). Un mes sin precio
 * queda con monto null y deja el total en null: no se adivina un precio.
 */
const agregarPrecioHistorico = async ({ resultados, clubId }) => {
  const periodosPorEtiqueta = new Map();
  for (const deuda of resultados) {
    if (!deuda.periodos.length) continue;
    const etiquetaId = String(deuda.etiqueta._id);
    if (!periodosPorEtiqueta.has(etiquetaId)) periodosPorEtiqueta.set(etiquetaId, new Set());
    deuda.periodos.forEach((p) => periodosPorEtiqueta.get(etiquetaId).add(p));
  }

  const montosPorEtiqueta = new Map(await Promise.all(
    [...periodosPorEtiqueta].map(async ([etiquetaId, periodos]) => [
      etiquetaId,
      await resolverPreciosPorPeriodo({ clubId, etiquetaId, periodos: [...periodos] }),
    ]),
  ));

  // Exentas, a futuro y al día no tienen períodos: desglose [] y total 0.
  for (const deuda of resultados) {
    const montos = montosPorEtiqueta.get(String(deuda.etiqueta._id));
    deuda.desglosePrecioHistorico = deuda.periodos.map((periodo) => ({ periodo, monto: montos.get(periodo) }));
    deuda.totalDeudaPrecioHistorico = deuda.desglosePrecioHistorico.some((d) => d.monto === null)
      ? null
      : deuda.desglosePrecioHistorico.reduce((total, d) => total + d.monto, 0);
  }
};

/**
 * Calcula la deuda de un socio basándose en sus suscripciones activas.
 * Retorna un array de deudas, una por suscripción.
 */
const calcularDeudaSuscripciones = async ({ socioId, clubId, incluirPrecioHistorico }) => {
  const hoy = periodoHoy();
  const ahora = new Date();

  // Ojo: no filtrar por fechaHasta >= hoy acá. Una suscripción cerrada con
  // fecha pasada puede seguir teniendo períodos sin pagar dentro de su propio
  // rango (ej. al excluir un mes puntual con /excluir-periodo, el tramo viejo
  // queda con fechaHasta pasado pero puede deber meses anteriores) — cada
  // suscripción ya acota sus propios "candidatos" a [fechaDesde, fechaHasta]
  // más abajo, así que no hace falta (ni conviene) descartarla acá.
  const suscripciones = await Suscripcion.find({
    socioId,
    clubId,
    active: true,
  })
    .populate('etiquetaId', 'nombre unidad uso_sistema')
    .lean();

  if (!suscripciones.length) return [];

  const resultados = await Promise.all(
    suscripciones.map(async (sus) => {
      const desde = sus.fechaDesde;
      // La deuda llega como máximo al mes en curso, aunque el tramo tenga
      // fechaHasta futura: se pueden adelantar cuotas (registrarCobro, hasta
      // MAX_MESES_ADELANTO), pero no se cobran deudas futuras (D3, #263).
      const hasta = sus.fechaHasta && sus.fechaHasta < hoy ? sus.fechaHasta : hoy;
      // El tramo sigue en curso si no tiene fin o termina este mes o después.
      // Los clientes lo usan para separar planes vigentes del historial, en vez
      // de inferirlo de fechaHasta && mesesDeuda === 0, que con D3 marca como
      // cerrado un tramo al día con fechaHasta futura (#263).
      const vigente = !sus.fechaHasta || sus.fechaHasta >= hoy;

      // Períodos ya pagados de esta etiqueta en toda la historia del socio
      // (no solo dentro del tramo vigente) — la grilla de edición de meses
      // los necesita para no dejar destildar un mes ya cobrado. Se calcula
      // antes del branch de exento: un tramo exento (ej. plan Staff) puede
      // convivir con meses ya pagados de antes de pasar a exento, y la
      // grilla necesita poder pintarlos igual (appcarc-backend, caso real de un socio de staff).
      const periodosPagados = (await Cuota.find({
        socioId, clubId, etiquetaId: sus.etiquetaId._id, estado: 'pagada', active: true,
      }).lean()).map((c) => c.periodo);

      if (sus.exento) {
        return {
          suscripcionId: sus._id,
          etiqueta: sus.etiquetaId,
          planId: sus.planId ?? null,
          fechaDesde: sus.fechaDesde,
          fechaHasta: sus.fechaHasta,
          vigente,
          ultimoPeriodoPagado: null,
          periodoActual: hoy,
          mesesDeuda: 0,
          periodos: [],
          periodosPagados,
          precioUnitario: null,
          totalDeuda: 0,
          exento: true,
        };
      }

      if (desde > hoy) {
        // Suscripción que arranca a futuro (ej. socio nuevo que paga por
        // adelantado el mes que viene): no debe nada todavía, pero se manda el
        // precio vigente para que la pantalla de cobro pueda sugerir el monto.
        const precioFuturo = await findPrecioVigente({
          clubId,
          etiquetaId: sus.etiquetaId._id,
          date: ahora,
        });
        return {
          suscripcionId: sus._id,
          etiqueta: sus.etiquetaId,
          planId: sus.planId ?? null,
          fechaDesde: sus.fechaDesde,
          fechaHasta: sus.fechaHasta,
          vigente,
          ultimoPeriodoPagado: null,
          periodoActual: hoy,
          mesesDeuda: 0,
          periodos: [],
          periodosPagados,
          precioUnitario: precioFuturo?.monto ?? null,
          totalDeuda: 0,
        };
      }

      const candidatos = expandPeriodos(desde, hasta);

      // Ojo: se busca por etiquetaId, NO por suscripcionId. Editar la grilla de
      // meses (setMesesActivos) puede desactivar el tramo viejo y crear uno
      // nuevo con otro _id para cubrir el mismo rango de fechas — si acá
      // filtráramos por suscripcionId exacto, todas las Cuota ya pagadas que
      // quedaron enganchadas al tramo anterior dejarían de reconocerse y la
      // deuda se recalcularía de golpe como si nunca se hubiera pagado nada
      // (bug real visto en producción, caso Julieta Tobar 2026-08-11). Una
      // Cuota pertenece a (socio, etiqueta, período), no a un tramo puntual.
      const [ultimaCuota, pagadas] = await Promise.all([
        Cuota.findOne({
          socioId,
          clubId,
          etiquetaId: sus.etiquetaId._id,
          estado: 'pagada',
          active: true,
          periodo: { $lte: hoy },
        })
          .sort({ periodo: -1 })
          .lean(),
        Cuota.find({
          socioId,
          clubId,
          etiquetaId: sus.etiquetaId._id,
          estado: 'pagada',
          active: true,
          periodo: { $in: candidatos },
        }).lean(),
      ]);

      const pagadasSet = new Set(pagadas.map((c) => c.periodo));
      const pendientes = candidatos.filter((p) => !pagadasSet.has(p));

      const precio = await findPrecioVigente({
        clubId,
        etiquetaId: sus.etiquetaId._id,
        date: ahora,
      });

      const precioUnitario = precio?.monto ?? null;

      return {
        suscripcionId: sus._id,
        etiqueta: sus.etiquetaId,
        planId: sus.planId ?? null,
        fechaDesde: sus.fechaDesde,
        fechaHasta: sus.fechaHasta,
        vigente,
        ultimoPeriodoPagado: ultimaCuota?.periodo ?? null,
        periodoActual: hoy,
        mesesDeuda: pendientes.length,
        periodos: pendientes,
        periodosPagados,
        precioUnitario,
        totalDeuda: precioUnitario !== null ? pendientes.length * precioUnitario : null,
      };
    }),
  );

  // Dos tramos activos no exentos de la misma etiqueta pueden superponerse (el
  // índice único solo impide que arranquen el mismo mes), y cada uno cobraba el
  // mes en común (#263, D7). Como una Cuota es de (socio, etiqueta, período),
  // el mes se debe una sola vez: queda en el tramo que arrancó primero y se
  // saca de los demás. Los exentos ya traen `periodos` vacío.
  const adeudadosPorEtiqueta = new Map();
  const porFechaDesde = [...resultados].sort((a, b) => a.fechaDesde.localeCompare(b.fechaDesde));
  for (const deuda of porFechaDesde) {
    const etiquetaId = String(deuda.etiqueta._id);
    if (!adeudadosPorEtiqueta.has(etiquetaId)) adeudadosPorEtiqueta.set(etiquetaId, new Set());
    const yaAdeudados = adeudadosPorEtiqueta.get(etiquetaId);
    const propios = deuda.periodos.filter((p) => !yaAdeudados.has(p));
    propios.forEach((p) => yaAdeudados.add(p));
    if (deuda.totalDeuda !== null) deuda.totalDeuda -= (deuda.periodos.length - propios.length) * deuda.precioUnitario;
    deuda.periodos = propios;
    deuda.mesesDeuda = propios.length;
  }

  if (incluirPrecioHistorico) await agregarPrecioHistorico({ resultados, clubId });

  return resultados;
};

/**
 * incluirPrecioHistorico (default false): agrega desglosePrecioHistorico y
 * totalDeudaPrecioHistorico a cada suscripción. Cuesta una consulta de Precios
 * por etiqueta adeudada, así que los llamadores en bucle (morosos, avisos,
 * export) no lo piden, y getSocioDeuda solo lo pide para quien tiene
 * cobros:precio-historico. totalDeuda no cambia en ningún caso.
 */
export const calcularDeuda = async ({ socioId, clubId, incluirPrecioHistorico = false }) => {
  const [suscripciones, otrosCargos] = await Promise.all([
    calcularDeudaSuscripciones({ socioId, clubId, incluirPrecioHistorico }),
    calcularOtrosCargos({ socioId, clubId }),
  ]);

  return { suscripciones, otrosCargos };
};
