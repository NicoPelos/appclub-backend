import { google } from 'googleapis';
import Socio from '../resources/socios/models/Socio.js';
import Cuota from '../resources/cuotas/models/Cuota.js';
import Suscripcion from '../resources/suscripciones/models/Suscripcion.js';
import Cobro from '../resources/cobros/models/Cobro.js';
import Escuelita from '../resources/escuelita/models/Escuelita.js';
import Plan from '../resources/planes/models/Plan.js';
import Movimiento from '../resources/movimientos/models/Movimiento.js';
import Horarios from '../resources/horarios/models/Horarios.js';
import Etiqueta from '../resources/etiquetas/models/Etiqueta.js';
import Asistencia from '../resources/asistencias/models/Asistencia.js';
import Advertencia from '../resources/advertencias/models/Advertencia.js';
import { calcularDeuda } from '../resources/cuotas/services/calcularDeuda.service.js';
import { ADVERTENCIA } from '../constants/advertenciaCodes.js';
import {
  ARG_OFFSET_MS, inicioDePeriodoArgentino, periodoActualArgentino, periodoDeFecha,
} from './fechaArgentina.js';
import {
  getEtiquetaMap, categoriaIngresoPorEtiqueta, CATEGORIAS_INGRESO, CATEGORIAS_EGRESO,
  buildIngresosEgresosPorCategoria,
} from '../resources/movimientos/services/categoriaMovimiento.service.js';

export { categoriaIngresoPorEtiqueta };

const auth = new google.auth.GoogleAuth({
  keyFile: 'google-credentials.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

// ─── Colores ──────────────────────────────────────────────────────────────────
const COLORS = {
  headerBg:  { red: 0.17, green: 0.35, blue: 0.62 },
  headerFg:  { red: 1,    green: 1,    blue: 1    },
  green:     { red: 0.72, green: 0.88, blue: 0.80 },
  red:       { red: 0.96, green: 0.79, blue: 0.79 },
  deuda1:    { red: 1,    green: 0.95, blue: 0.70 }, // 1-2 meses
  deuda2:    { red: 0.98, green: 0.80, blue: 0.45 }, // 3-5 meses
  deuda3:    { red: 0.90, green: 0.45, blue: 0.38 }, // 6+ meses
  cierreBg:  { red: 0.88, green: 0.90, blue: 0.94 },
};

const TAB_COLOR = {
  Resumen: { red: 0.17, green: 0.35, blue: 0.62 },
  Datos:   { red: 0.93, green: 0.93, blue: 0.88 },
};

// ─── Helpers de formato de valores ────────────────────────────────────────────
// Hay dos clases de fecha (appcarc-backend#283). Las de "fecha sola" (nacimiento,
// alta, inscripción, Horarios.fecha) llegan como 'YYYY-MM-DD' y quedan a las
// 00:00 UTC: se formatean en UTC, porque en hora argentina serían el día
// anterior. Las que son un instante real (movimientos, cobros, asistencias,
// fecha de pago, hora de entrada) se formatean en hora argentina: con el
// reloj del container (UTC), lo de 21 a 24 hs salía con el día siguiente.
const fmtDate = (d) => {
  if (!d) return '';
  const date = new Date(d);
  return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`;
};

const aHoraArgentina = (d) => new Date(new Date(d).getTime() + ARG_OFFSET_MS);

const fmtDateArg = (d) => (d ? fmtDate(aHoraArgentina(d)) : '');

const fmtTime = (d) => {
  if (!d) return '';
  const date = aHoraArgentina(d);
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
};

// Suma `n` meses (puede ser negativo) a un período 'YYYY-MM'.
const sumarMeses = (periodo, n) => {
  const [y, m] = periodo.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

// Los últimos `months` períodos, terminando en el mes en curso de Argentina.
const ultimosPeriodos = (months) => {
  const actual = periodoActualArgentino();
  const periods = [];
  for (let i = months - 1; i >= 0; i--) periods.push(sumarMeses(actual, -i));
  return periods;
};

const fmtMoney = (n) => (n != null ? `$${Number(n).toLocaleString('es-AR')}` : '');

const generatePeriodos = (months = 24) => ultimosPeriodos(months);

const periodLabel = (p) => {
  const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const [year, month] = p.split('-');
  return `${MESES[parseInt(month, 10) - 1]}-${year.slice(2)}`;
};

// ─── Constructores de datos por pestaña ──────────────────────────────────────

const buildSociosRows = async (clubId) => {
  const headers = [
    'N° Socio', 'Apellido', 'Nombre', 'DNI', 'Sexo', 'Fecha Nacimiento',
    'Email', 'Teléfono', 'Tel. Emergencia', 'Ciudad',
    'Estado', 'Condición', 'Observaciones', 'Fecha de Asociado',
  ];
  const socios = await Socio.find({ clubId, active: true }).sort({ apellido: 1, nombre: 1 }).lean();
  const rows = socios.map((s) => [
    s.socioNumber || '',
    s.apellido || '',
    s.nombre || '',
    s.dni || '',
    s.sexo || '',
    fmtDate(s.fechaNacimiento),
    s.correoElectronico || '',
    s.telefono || '',
    s.telefonoEmergencia || '',
    s.ciudad || '',
    s.estado || '',
    s.condicionObs || '',
    s.observaciones || '',
    fmtDate(s.fechaDeAsociado),
  ]);
  return { headers, rows };
};

// Una suscripción exenta nunca genera Cuota (calcularDeuda.service.js corta
// antes) — sin esto, los períodos cubiertos por una suscripción exenta
// quedarían en blanco en la matriz en vez de marcarse como al día.
const buildExentoMap = async ({ clubId, etiquetaIds, periodos }) => {
  const suscripciones = await Suscripcion.find({
    clubId, etiquetaId: { $in: etiquetaIds }, active: true, exento: true,
  }).lean();

  const map = {};
  for (const s of suscripciones) {
    const sid = s.socioId.toString();
    if (!map[sid]) map[sid] = new Set();
    const hasta = s.fechaHasta || periodos[periodos.length - 1];
    for (const p of periodos) {
      if (p >= s.fechaDesde && p <= hasta) map[sid].add(p);
    }
  }
  return map;
};

// Deuda "real" por socio para SU etiqueta puntual (cuota_social o la de
// cuota_escuelita que le corresponda a su plan), usando el mismo
// calcularDeuda que ya confía el resto del sistema (job de morosidad,
// pantalla de deuda del socio) — en vez de contar a mano cuántas Cuota
// quedaron con estado:'pendiente'. Esto importa porque una Cuota 'pendiente'
// hoy solo existe si vino de la migración histórica del Excel viejo: la
// deuda que se genera de acá en adelante nunca crea ese registro, así que
// contar 'pendiente' subestima (o directamente no detecta) deuda nueva. Un
// socio puede tener más de un tramo de suscripción a la misma etiqueta (ver
// caso Zurita #191) — se suman los mesesDeuda y se unen los períodos
// pendientes de todos los tramos que matchean.
//
// `etiquetaIdPorSocio` (no un único `usoSistema` global): hay VARIAS
// etiquetas de cuota de escuelita, una por plan (X1/X2, Adultos, etc.), solo
// una tiene uso_sistema 'cuota_escuelita' (appcarc-backend#156, mismo
// patrón que advertencias y el recordatorio de cuotas). Para cuota social sí
// hay una única etiqueta global — el caller le pasa el mismo id para todos.
const CONCURRENCIA_DEUDA = 25;
const buildDeudaMap = async ({ clubId, socios, etiquetaIdPorSocio }) => {
  const map = {};
  for (let i = 0; i < socios.length; i += CONCURRENCIA_DEUDA) {
    const chunk = socios.slice(i, i + CONCURRENCIA_DEUDA);
    await Promise.all(chunk.map(async (s) => {
      const sid = s._id.toString();
      const etiquetaEsperada = etiquetaIdPorSocio.get(sid);
      if (!etiquetaEsperada) { map[sid] = { pendientes: new Set(), mesesDeuda: 0 }; return; }
      try {
        const deuda = await calcularDeuda({ socioId: s._id, clubId });
        const relevantes = deuda.suscripciones.filter((sub) => String(sub.etiqueta?._id) === etiquetaEsperada);
        const pendientes = new Set();
        let mesesDeuda = 0;
        for (const sub of relevantes) {
          mesesDeuda += sub.mesesDeuda || 0;
          for (const p of sub.periodos || []) pendientes.add(p);
        }
        map[sid] = { pendientes, mesesDeuda };
      } catch {
        map[sid] = { pendientes: new Set(), mesesDeuda: 0 };
      }
    }));
  }
  return map;
};

// Núcleo compartido de la matriz de cuotas (mes a mes, ✓/✗) — lo usan tanto
// Cuotas Sociales como Cuotas Escuelita. Todos los estados van en la misma
// pestaña, con una columna "Estado" para filtrar/pivotear desde Sheets en vez
// de tener que abrir una pestaña distinta por cada uno.
const buildCuotasMatrixRows = async ({ clubId, socios, etiquetaIdPorSocio, periodos, extraHeaders = [], extraCols = () => [] }) => {
  const INFO_COLS = 4 + extraHeaders.length;
  const headers = ['N° Socio', 'Apellido', 'Nombre', 'DNI', ...extraHeaders, ...periodos.map(periodLabel), 'Meses adeudados'];

  if (socios.length === 0) {
    return { headers, rows: [], dataStartCol: INFO_COLS, dataEndCol: INFO_COLS + periodos.length, adeudadosCol: INFO_COLS + periodos.length };
  }

  // Unión de todas las etiquetas relevantes entre los socios de esta matriz
  // (para cuota social es una sola; para escuelita, una por plan) — cada
  // Cuota/Suscripcion sigue quedando scopeada por socioId al armar el mapa,
  // así que traer de más acá no mezcla la deuda de un socio con la de otro.
  const etiquetaIds = [...new Set(etiquetaIdPorSocio.values())];

  const cuotaFilter = { clubId, periodo: { $in: periodos }, active: true, etiquetaId: { $in: etiquetaIds }, socioId: { $in: socios.map((s) => s._id) } };
  const [cuotas, exentoMap, deudaMap] = await Promise.all([
    Cuota.find(cuotaFilter).lean(),
    buildExentoMap({ clubId, etiquetaIds, periodos }),
    buildDeudaMap({ clubId, socios, etiquetaIdPorSocio }),
  ]);

  const map = {};
  for (const c of cuotas) {
    const sid = c.socioId.toString();
    if (!map[sid]) map[sid] = {};
    map[sid][c.periodo] = c.estado;
  }

  const rows = socios.map((s) => {
    const sid = s._id.toString();
    const socioData = map[sid] || {};
    const exentoPeriodos = exentoMap[sid];
    const deuda = deudaMap[sid] || { pendientes: new Set(), mesesDeuda: 0 };

    const cells = periodos.map((p) => {
      if (exentoPeriodos?.has(p)) return '✓';
      const estado = socioData[p];
      if (estado === 'pagada') return '✓';
      if (estado === 'pendiente' || deuda.pendientes.has(p)) return '✗';
      return '';
    });

    return [
      s.socioNumber || '', s.apellido || '', s.nombre || '', s.dni || '',
      ...extraCols(s),
      ...cells,
      // Socio en Baja: "—" en vez del número (appcarc-backend#307). Su deuda
      // puede seguir creciendo si la suscripción quedó abierta (#308) y no
      // es deuda a cobrar; los ✓/✗ quedan como historia. Aplica a las dos
      // pestañas de cuotas (social y escuelita), que comparten este núcleo.
      s.estado === 'Baja' ? '—' : deuda.mesesDeuda,
    ];
  });

  return { headers, rows, dataStartCol: INFO_COLS, dataEndCol: INFO_COLS + periodos.length, adeudadosCol: INFO_COLS + periodos.length };
};

export const buildCuotasSocialesRows = async (clubId) => {
  const periodos = generatePeriodos(24);
  const [socios, etiquetas] = await Promise.all([
    Socio.find({ clubId, active: true }).sort({ apellido: 1, nombre: 1 }).lean(),
    Etiqueta.find({ clubId, uso_sistema: 'cuota_social', active: true }).lean(),
  ]);
  // Una única etiqueta social para todo el club — mismo id para cada socio.
  const etiquetaSocialId = etiquetas[0] ? String(etiquetas[0]._id) : null;
  const etiquetaIdPorSocio = new Map(socios.map((s) => [String(s._id), etiquetaSocialId]));
  return buildCuotasMatrixRows({
    clubId, socios, etiquetaIdPorSocio, periodos,
    extraHeaders: ['Estado'], extraCols: (s) => [s.estado || ''],
  });
};

export const buildCuotasEscuelitaRows = async (clubId) => {
  const periodos = generatePeriodos(24);
  const alumnos = await Escuelita.find({ clubId, active: true })
    .populate('socioId', 'socioNumber nombre apellido dni estado _id')
    .populate('planId', 'nombre etiquetaId')
    .lean();

  const socios = alumnos.filter((a) => a.socioId).map((a) => ({ ...a.socioId, _planNombre: a.planId?.nombre || '' }));
  // Cada alumno usa la etiqueta de SU plan (X1/X2, Adultos, etc.) — no hay
  // una única etiqueta global de cuota de escuelita (appcarc-backend#156).
  const etiquetaIdPorSocio = new Map(
    alumnos
      .filter((a) => a.socioId && a.planId?.etiquetaId)
      .map((a) => [String(a.socioId._id), String(a.planId.etiquetaId)]),
  );

  return buildCuotasMatrixRows({
    clubId, socios, etiquetaIdPorSocio, periodos,
    extraHeaders: ['Categoría', 'Estado'], extraCols: (s) => [s._planNombre || '', s.estado || ''],
  });
};

const buildCobrosRows = async (clubId) => {
  const headers = ['Fecha', 'N° Socio', 'Apellido', 'Nombre', 'Concepto', 'Período', 'Monto', 'Método', 'Responsable'];
  const [cobros, etiquetaMap] = await Promise.all([
    Cobro.find({ clubId, active: true })
      .sort({ date: -1 })
      .populate({ path: 'items.socioId', select: 'socioNumber nombre apellido' })
      .lean(),
    getEtiquetaMap(clubId),
  ]);

  const rows = [];
  for (const c of cobros) {
    for (const item of c.items) {
      const s = item.socioId || {};
      const etiqueta = etiquetaMap[item.etiquetaId?.toString()];
      rows.push([fmtDateArg(c.date), s.socioNumber || '', s.apellido || '', s.nombre || '',
        etiqueta?.nombre || '', item.periodo, fmtMoney(item.amount), c.paymentMethod, c.responsable]);
    }
  }
  return { headers, rows };
};

const buildEscuelitaRows = async (clubId) => {
  const headers = ['N° Socio', 'Apellido', 'Nombre', 'DNI', 'Categoría', 'Frec/sem', 'Estado', 'Inscripción'];
  const alumnos = await Escuelita.find({ clubId, active: true })
    .populate('socioId', 'socioNumber nombre apellido dni')
    .populate('planId', 'nombre atributos')
    .sort({ createdAt: -1 })
    .lean();

  const rows = alumnos.map((a) => {
    const s = a.socioId || {};
    return [
      s.socioNumber || '', s.apellido || '', s.nombre || '', s.dni || '',
      a.planId?.nombre || '',
      a.planId?.atributos?.frecuenciaSemanal ? `${a.planId.atributos.frecuenciaSemanal}x semana` : '',
      a.estado,
      fmtDate(a.fechaInscripcion),
    ];
  });
  return { headers, rows };
};

const MESES_LARGOS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

// Orden cronológico (no el más reciente primero, como el resto de las
// pestañas) porque acá lo que importa es poder seguir el saldo acumulado mes
// a mes, igual que en la planilla de control de caja en papel — una fila de
// "Cierre <mes>" al final de cada mes con el saldo teórico del sistema para
// poder cotejarlo contra lo contado en efectivo + lo que hay en la cuenta.
export const buildMovimientosRows = async (clubId) => {
  const headers = ['Fecha', 'Tipo', 'Concepto', 'Monto', 'Método', 'Responsable', 'Saldo', 'Ingresos del mes', 'Egresos del mes'];
  const movimientos = await Movimiento.find({ clubId, active: true }).sort({ date: 1 }).lean();

  const rows = [];
  const cierreRowIndices = [];
  let saldo = 0;
  let mesActual = null;
  let ingresosMes = 0;
  let egresosMes = 0;

  const cerrarMes = () => {
    if (mesActual === null) return;
    rows.push(['Cierre ' + mesActual, '', '', '', '', '', fmtMoney(saldo), fmtMoney(ingresosMes), fmtMoney(egresosMes)]);
    cierreRowIndices.push(rows.length - 1);
  };

  for (const m of movimientos) {
    const [anio, mes] = periodoDeFecha(new Date(m.date)).split('-');
    const mesKey = `${MESES_LARGOS[Number(mes) - 1]} ${anio}`;
    if (mesActual !== null && mesKey !== mesActual) {
      cerrarMes();
      ingresosMes = 0;
      egresosMes = 0;
    }
    mesActual = mesKey;

    if (m.type === 'Ingreso') { saldo += m.amount; ingresosMes += m.amount; }
    else { saldo -= m.amount; egresosMes += m.amount; }

    rows.push([
      fmtDateArg(m.date), m.type, m.concept || m.description || '',
      fmtMoney(m.amount), m.paymentMethod, m.responsable,
      fmtMoney(saldo), '', '',
    ]);
  }
  cerrarMes();

  return { headers, rows, cierreRowIndices };
};

const buildHorariosRows = async (clubId) => {
  const headers = ['Fecha', 'Apellido', 'Nombre', 'Tarea', 'Hora Entrada', 'Hora Salida', 'Horas Totales', 'Observaciones'];
  const desde = new Date();
  desde.setMonth(desde.getMonth() - 12);
  desde.setDate(1);

  const horarios = await Horarios.find({ clubId, active: true, fecha: { $gte: desde } })
    .populate('socioId', 'nombre apellido')
    .populate('etiquetaId', 'nombre')
    .sort({ fecha: -1 })
    .lean();

  const rows = horarios.map((h) => [
    fmtDate(h.fecha),
    h.socioId?.apellido || '',
    h.socioId?.nombre || '',
    h.etiquetaId?.nombre || '',
    fmtTime(h.horaEntrada),
    fmtTime(h.horaSalida),
    h.totalHoras != null ? h.totalHoras : '',
    h.observaciones || '',
  ]);
  return { headers, rows };
};

const buildAsistenciasRows = async (clubId) => {
  const headers = [
    'Fecha', 'Tipo', 'Apellido', 'Nombre', 'DNI', 'Es Socio',
    'Categoría', 'Tipo Pase', 'Estado Pago', 'Monto', 'Forma Pago', 'Observaciones',
  ];
  const desde = new Date();
  desde.setMonth(desde.getMonth() - 12);
  desde.setDate(1);

  const asistencias = await Asistencia.find({ clubId, active: true, fecha: { $gte: desde } })
    .sort({ fecha: -1 })
    .lean();

  const TIPO_LABEL = { muro_libre: 'Muro Libre', escuelita: 'Escuelita' };

  const rows = asistencias.map((a) => [
    fmtDateArg(a.fecha),
    TIPO_LABEL[a.tipo] || a.tipo,
    a.apellido || '',
    a.nombre || '',
    a.dni || '',
    a.esSocio ? 'Sí' : 'No',
    a.categoria || '',
    a.tipoPase || '',
    a.estadoPago || '',
    a.monto ? fmtMoney(a.monto) : '',
    a.formaPago || '',
    a.observaciones || '',
  ]);
  return { headers, rows };
};

const buildMuroLibreRows = async (clubId) => {
  const headers = ['Fecha', 'Apellido', 'Nombre', 'DNI', 'Es Socio', 'Tipo Pase', 'Estado Pago', 'Monto', 'Forma Pago', 'Período', 'Observaciones'];
  const asistencias = await Asistencia.find({ clubId, tipo: 'muro_libre', active: true })
    .sort({ fecha: -1 })
    .lean();
  const rows = asistencias.map((a) => [
    fmtDateArg(a.fecha),
    a.apellido || '',
    a.nombre || '',
    a.dni || '',
    a.esSocio ? 'Sí' : 'No',
    a.tipoPase || '',
    a.estadoPago || '',
    a.monto ? fmtMoney(a.monto) : '',
    a.formaPago || '',
    a.periodo || '',
    a.observaciones || '',
  ]);
  return { headers, rows };
};

// Formato "largo"/tidy: una fila por cuota real (socio + etiqueta + período).
// Pensada para que cualquiera arme sus propias tablas dinámicas o gráficos en
// Sheets — las pestañas de matriz (una columna por mes) son perfectas para
// leer a simple vista, pero imposibles de pivotear directamente.
export const buildDatosLargoRows = async (clubId) => {
  const headers = ['N° Socio', 'Apellido', 'Nombre', 'Estado Socio', 'Etiqueta', 'Período', 'Estado Cuota', 'Monto', 'Fecha de Pago'];
  const ESTADO_LABEL = { pagada: 'Pagada', pendiente: 'Pendiente', anulada: 'Anulada' };

  // No hay una única etiqueta global de cuota de escuelita — hay una por
  // plan (X1/X2, Adultos, etc.), appcarc-backend#156. Se junta la etiqueta
  // social (única) con la de CADA plan de escuelita activo, en vez de
  // buscar solo la que tiene uso_sistema 'cuota_escuelita'.
  const [etiquetaSocial, planesEscuelita] = await Promise.all([
    Etiqueta.findOne({ clubId, active: true, uso_sistema: 'cuota_social' }).lean(),
    Plan.find({ clubId, active: true, tipo: 'escuelita' }).select('etiquetaId').lean(),
  ]);
  const etiquetaIds = [
    ...(etiquetaSocial ? [etiquetaSocial._id] : []),
    ...new Set(planesEscuelita.map((p) => p.etiquetaId).filter(Boolean).map(String)),
  ];
  if (etiquetaIds.length === 0) return { headers, rows: [] };
  const etiquetas = await Etiqueta.find({ clubId, _id: { $in: etiquetaIds } }).lean();
  const etiquetaMap = {};
  etiquetas.forEach((e) => { etiquetaMap[e._id.toString()] = e.nombre; });

  const cuotas = await Cuota.find({ clubId, active: true, etiquetaId: { $in: etiquetaIds } })
    .populate('socioId', 'socioNumber nombre apellido estado')
    .sort({ periodo: 1 })
    .lean();

  const rows = cuotas
    .filter((c) => c.socioId)
    .map((c) => {
      const s = c.socioId;
      return [
        s.socioNumber || '', s.apellido || '', s.nombre || '', s.estado || '',
        etiquetaMap[c.etiquetaId?.toString()] || '',
        c.periodo,
        ESTADO_LABEL[c.estado] || c.estado,
        c.montoPagadoSnapshot || c.montoEsperadoSnapshot || '',
        fmtDateArg(c.fechaPago),
      ];
    });

  return { headers, rows };
};

// ─── Resumen (portada con números clave + gráficos) ──────────────────────────
// La categorización de ingresos/egresos (categoriaIngresoPorEtiqueta,
// buildIngresosEgresosPorCategoria, etc.) vive en
// resources/movimientos/services/categoriaMovimiento.service.js — compartida
// con GET /api/movimientos/resumen-por-categoria (ver import más arriba).

const RESUMEN_LAYOUT = {
  estadoHeaderRow: 4,    // fila 5 — A:B
  estadoDataRows: 2,     // Activo, Adherente (sin Baja)
  morosidadHeaderRow: 4, // fila 5 — D:E
  morosidadDataRows: 4,  // Al día / 3-5 / 6-11 / 12+
  recaudacionHeaderRow: 4, // fila 5 — G:H
  recaudacionDataRows: 12,
  ingresosHeaderRow: 4,    // fila 5 — J:K
  ingresosDataRows: CATEGORIAS_INGRESO.length,
  egresosHeaderRow: 4,     // fila 5 — M:N
  egresosDataRows: CATEGORIAS_EGRESO.length,
  chartsRow: 20,
};

const buildResumenData = async (clubId) => {
  const [activos, adherentes, morosos] = await Promise.all([
    Socio.countDocuments({ clubId, active: true, estado: 'Activo' }),
    Socio.countDocuments({ clubId, active: true, estado: 'Adherente' }),
    Advertencia.countDocuments({ clubId, codigo: ADVERTENCIA.MOROSIDAD_CUOTA_SOCIAL, estado: 'abierta' }),
  ]);

  // Morosidad: bandas mutuamente excluyentes según meses de deuda de Cuota
  // Social (mismo umbral de 3 meses que ya usa el job de aviso).
  const etiquetaSocial = await Etiqueta.findOne({ clubId, uso_sistema: 'cuota_social', active: true }).lean();
  const sociosVigentes = await Socio.find({ clubId, active: true, estado: { $in: ['Activo', 'Adherente'] } }).select('_id').lean();
  const bandas = { 'Al día': 0, '3-5 meses': 0, '6-11 meses': 0, '12+ meses': 0 };
  if (etiquetaSocial) {
    const etiquetaSocialId = String(etiquetaSocial._id);
    const etiquetaIdPorSocio = new Map(sociosVigentes.map((s) => [String(s._id), etiquetaSocialId]));
    const deudaMap = await buildDeudaMap({ clubId, socios: sociosVigentes, etiquetaIdPorSocio });
    for (const s of sociosVigentes) {
      const meses = deudaMap[s._id.toString()]?.mesesDeuda || 0;
      if (meses >= 12) bandas['12+ meses']++;
      else if (meses >= 6) bandas['6-11 meses']++;
      else if (meses >= 3) bandas['3-5 meses']++;
      else bandas['Al día']++;
    }
  }

  const mesesOrden = ultimosPeriodos(12);
  const desde = inicioDePeriodoArgentino(mesesOrden[0]);

  const movimientosIngreso = await Movimiento.find({ clubId, active: true, type: 'Ingreso', date: { $gte: desde } })
    .select('date amount')
    .lean();

  const porMes = Object.fromEntries(mesesOrden.map((k) => [k, 0]));
  for (const m of movimientosIngreso) {
    const key = periodoDeFecha(new Date(m.date));
    if (porMes[key] !== undefined) porMes[key] += m.amount || 0;
  }

  const etiquetaMap = await getEtiquetaMap(clubId);
  const { ingresos, egresos } = await buildIngresosEgresosPorCategoria({ clubId, desde, etiquetaMap });

  return {
    estados: [['Activo', activos], ['Adherente', adherentes]],
    morosidad: Object.entries(bandas),
    recaudacion: mesesOrden.map((k) => [periodLabel(k), porMes[k]]),
    ingresosPorCategoria: ingresos,
    egresosPorCategoria: egresos,
    morosos,
    totalVigentes: activos + adherentes,
    actualizado: `${fmtDateArg(new Date())} ${fmtTime(new Date())}`,
  };
};

const writeResumenTab = async (spreadsheetId, resumen) => {
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `'Resumen'!A:Z` });

  const { estadoHeaderRow, morosidadHeaderRow, recaudacionHeaderRow, ingresosHeaderRow, egresosHeaderRow } = RESUMEN_LAYOUT;
  const values = [];
  values[0] = ['Resumen del club'];
  values[1] = [`Actualizado: ${resumen.actualizado}`];

  const placeTable = (headerRow, headerLabels, dataRows, colOffset) => {
    values[headerRow] = values[headerRow] || [];
    headerLabels.forEach((h, i) => { values[headerRow][colOffset + i] = h; });
    dataRows.forEach((row, i) => {
      const r = headerRow + 1 + i;
      values[r] = values[r] || [];
      row.forEach((v, j) => { values[r][colOffset + j] = v; });
    });
  };

  placeTable(estadoHeaderRow, ['Estado', 'Cantidad'], resumen.estados, 0);
  placeTable(morosidadHeaderRow, ['Deuda cuota social', 'Socios'], resumen.morosidad, 3);
  placeTable(recaudacionHeaderRow, ['Mes', 'Recaudado'], resumen.recaudacion, 6);
  placeTable(ingresosHeaderRow, ['Categoría', 'Ingresos (12m)'], resumen.ingresosPorCategoria, 9);
  placeTable(egresosHeaderRow, ['Categoría', 'Egresos (12m)'], resumen.egresosPorCategoria, 12);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'Resumen'!A1`,
    valueInputOption: 'RAW',
    resource: { values },
  });
};

const pieChartRequest = ({ sheetId, title, headerRow, dataRows, col, anchorRow, anchorCol }) => ({
  addChart: {
    chart: {
      spec: {
        title,
        pieChart: {
          legendPosition: 'RIGHT_LEGEND',
          domain: { sourceRange: { sources: [{ sheetId, startRowIndex: headerRow + 1, endRowIndex: headerRow + 1 + dataRows, startColumnIndex: col, endColumnIndex: col + 1 }] } },
          series: { sourceRange: { sources: [{ sheetId, startRowIndex: headerRow + 1, endRowIndex: headerRow + 1 + dataRows, startColumnIndex: col + 1, endColumnIndex: col + 2 }] } },
        },
      },
      position: { overlayPosition: { anchorCell: { sheetId, rowIndex: anchorRow, columnIndex: anchorCol }, widthPixels: 380, heightPixels: 260 } },
    },
  },
});

const buildResumenFormatAndCharts = (sheetId, resumen) => {
  const { estadoHeaderRow, estadoDataRows, morosidadHeaderRow, morosidadDataRows, recaudacionHeaderRow, recaudacionDataRows, ingresosHeaderRow, ingresosDataRows, egresosHeaderRow, egresosDataRows, chartsRow } = RESUMEN_LAYOUT;

  const headerRanges = [
    [estadoHeaderRow, 0, 2], [morosidadHeaderRow, 3, 2], [recaudacionHeaderRow, 6, 2], [ingresosHeaderRow, 9, 2], [egresosHeaderRow, 12, 2],
  ];

  const requests = [
    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 16 } } }, fields: 'userEnteredFormat.textFormat' } },
    ...headerRanges.map(([row, col, span]) => ({
      repeatCell: {
        range: { sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: col, endColumnIndex: col + span },
        cell: { userEnteredFormat: { backgroundColor: COLORS.headerBg, textFormat: { foregroundColor: COLORS.headerFg, bold: true } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat)',
      },
    })),
    pieChartRequest({ sheetId, title: 'Socios por estado (sin Bajas)', headerRow: estadoHeaderRow, dataRows: estadoDataRows, col: 0, anchorRow: chartsRow, anchorCol: 0 }),
    pieChartRequest({ sheetId, title: 'Deuda de cuota social', headerRow: morosidadHeaderRow, dataRows: morosidadDataRows, col: 3, anchorRow: chartsRow, anchorCol: 5 }),
    pieChartRequest({ sheetId, title: 'Ingresos por categoría (12 meses)', headerRow: ingresosHeaderRow, dataRows: ingresosDataRows, col: 9, anchorRow: chartsRow, anchorCol: 10 }),
    pieChartRequest({ sheetId, title: 'Egresos por categoría (12 meses)', headerRow: egresosHeaderRow, dataRows: egresosDataRows, col: 12, anchorRow: chartsRow + 16, anchorCol: 0 }),
    {
      addChart: {
        chart: {
          spec: {
            title: 'Recaudación mensual (últimos 12 meses)',
            basicChart: {
              chartType: 'COLUMN',
              legendPosition: 'NO_LEGEND',
              axis: [{ position: 'BOTTOM_AXIS' }, { position: 'LEFT_AXIS' }],
              domains: [{ domain: { sourceRange: { sources: [{ sheetId, startRowIndex: recaudacionHeaderRow + 1, endRowIndex: recaudacionHeaderRow + 1 + recaudacionDataRows, startColumnIndex: 6, endColumnIndex: 7 }] } } }],
              series: [{ series: { sourceRange: { sources: [{ sheetId, startRowIndex: recaudacionHeaderRow + 1, endRowIndex: recaudacionHeaderRow + 1 + recaudacionDataRows, startColumnIndex: 7, endColumnIndex: 8 }] } } }],
            },
          },
          position: { overlayPosition: { anchorCell: { sheetId, rowIndex: chartsRow, columnIndex: 16 }, widthPixels: 480, heightPixels: 260 } },
        },
      },
    },
  ];
  return requests;
};

// ─── Helpers de la API de Sheets ─────────────────────────────────────────────

const TAB_NAMES = ['Resumen', 'Socios', 'Cuotas Sociales', 'Cuotas Escuelita', 'Cobros', 'Escuelita', 'Movimientos', 'Asistencias', 'Muro Libre', 'Horarios', 'Datos'];

const getOrCreateSpreadsheet = async (clubName, spreadsheetId) => {
  if (spreadsheetId) return { id: spreadsheetId, isNew: false };

  const res = await sheets.spreadsheets.create({
    resource: {
      properties: { title: `${clubName} — Registro` },
      sheets: TAB_NAMES.map((title, index) => ({ properties: { sheetId: index, title, index } })),
    },
  });
  const id = res.data.spreadsheetId;
  return { id, isNew: true };
};

const getSheetIdMap = async (spreadsheetId) => {
  const res = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
  const map = {};
  for (const s of res.data.sheets) map[s.properties.title] = s.properties.sheetId;
  return map;
};

const ensureTabsExist = async (spreadsheetId, existingMap) => {
  const missing = TAB_NAMES.filter((t) => !(t in existingMap));
  if (missing.length === 0) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) },
  });
};

// Pestañas de una versión anterior de este export (ej. los splits por estado
// de una iteración previa) quedan huérfanas: ya no se reescriben, pero siguen
// ahí mostrando datos congelados — confunden más de lo que ayudan. Se llama
// después de ensureTabsExist, así siempre queda al menos una pestaña viva
// antes de borrar el resto.
const removeOrphanTabs = async (spreadsheetId, existingMap) => {
  const orphanIds = Object.entries(existingMap)
    .filter(([title]) => !TAB_NAMES.includes(title))
    .map(([, sheetId]) => sheetId);
  if (orphanIds.length === 0) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: { requests: orphanIds.map((sheetId) => ({ deleteSheet: { sheetId } })) },
  });
};

const writeTab = async (spreadsheetId, tabName, headers, rows) => {
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${tabName}'!A:ZZ` });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tabName}'!A1`,
    valueInputOption: 'RAW',
    resource: { values: [headers, ...rows] },
  });
};

// Los charts y las reglas de formato condicional son "addX": si se vuelven a
// pedir en cada corrida (el job corre todos los días a las 3am) se apilan sin
// límite. Antes de reconstruir el formato de cada corrida, se borra todo lo
// existente en cada pestaña para que quede siempre exactamente un juego
// limpio, no más.
const clearExistingDecorations = async (spreadsheetId) => {
  const res = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties.sheetId,conditionalFormats,charts.chartId)' });
  const requests = [];
  for (const sheet of res.data.sheets) {
    const sheetId = sheet.properties.sheetId;
    const cfCount = sheet.conditionalFormats?.length || 0;
    for (let i = cfCount - 1; i >= 0; i--) {
      requests.push({ deleteConditionalFormatRule: { sheetId, index: i } });
    }
    for (const chart of sheet.charts || []) {
      requests.push({ deleteEmbeddedObject: { objectId: chart.chartId } });
    }
  }
  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, resource: { requests } });
  }
};

const buildFormatRequests = (sheetId, numCols, cuotasOpts = null, cierreRowIndices = null) => {
  const requests = [
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: numCols },
        cell: { userEnteredFormat: { backgroundColor: COLORS.headerBg, textFormat: { foregroundColor: COLORS.headerFg, bold: true } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat)',
      },
    },
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    },
  ];

  if (cuotasOpts) {
    const { startCol, endCol, adeudadosCol } = cuotasOpts;
    requests.push(
      { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenColumnCount: startCol } }, fields: 'gridProperties.frozenColumnCount' } },
      { addConditionalFormatRule: { rule: { ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: startCol, endColumnIndex: endCol }], booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: '✓' }] }, format: { backgroundColor: COLORS.green } } }, index: 0 } },
      { addConditionalFormatRule: { rule: { ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: startCol, endColumnIndex: endCol }], booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: '✗' }] }, format: { backgroundColor: COLORS.red } } }, index: 1 } },
      { addConditionalFormatRule: { rule: { ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: adeudadosCol, endColumnIndex: adeudadosCol + 1 }], booleanRule: { condition: { type: 'NUMBER_GREATER_THAN_EQ', values: [{ userEnteredValue: '6' }] }, format: { backgroundColor: COLORS.deuda3 } } }, index: 2 } },
      { addConditionalFormatRule: { rule: { ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: adeudadosCol, endColumnIndex: adeudadosCol + 1 }], booleanRule: { condition: { type: 'NUMBER_BETWEEN', values: [{ userEnteredValue: '3' }, { userEnteredValue: '5' }] }, format: { backgroundColor: COLORS.deuda2 } } }, index: 3 } },
      { addConditionalFormatRule: { rule: { ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: adeudadosCol, endColumnIndex: adeudadosCol + 1 }], booleanRule: { condition: { type: 'NUMBER_BETWEEN', values: [{ userEnteredValue: '1' }, { userEnteredValue: '2' }] }, format: { backgroundColor: COLORS.deuda1 } } }, index: 4 } },
    );
  }

  if (cierreRowIndices?.length) {
    for (const rowIndex of cierreRowIndices) {
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: rowIndex + 1, endRowIndex: rowIndex + 2, startColumnIndex: 0, endColumnIndex: numCols },
          cell: { userEnteredFormat: { backgroundColor: COLORS.cierreBg, textFormat: { bold: true } } },
          fields: 'userEnteredFormat(backgroundColor,textFormat)',
        },
      });
    }
  }

  return requests;
};

// ─── Export principal ─────────────────────────────────────────────────────────

export const exportToSheets = async ({ clubId, clubName = 'CARC', spreadsheetId: existingSpreadsheetId = null }) => {
  const [socios, cuotasSociales, cuotasEscuelita, cobros, escuelita, movimientos, asistencias, muroLibre, horarios, datos, resumenData] = await Promise.all([
    buildSociosRows(clubId),
    buildCuotasSocialesRows(clubId),
    buildCuotasEscuelitaRows(clubId),
    buildCobrosRows(clubId),
    buildEscuelitaRows(clubId),
    buildMovimientosRows(clubId),
    buildAsistenciasRows(clubId),
    buildMuroLibreRows(clubId),
    buildHorariosRows(clubId),
    buildDatosLargoRows(clubId),
    buildResumenData(clubId),
  ]);

  const { id: spreadsheetId, isNew } = await getOrCreateSpreadsheet(clubName, existingSpreadsheetId);

  const sheetIdMap = await getSheetIdMap(spreadsheetId);
  await ensureTabsExist(spreadsheetId, sheetIdMap);
  await removeOrphanTabs(spreadsheetId, sheetIdMap);
  const allSheetIds = await getSheetIdMap(spreadsheetId);

  const tabs = [
    { name: 'Socios', data: socios },
    { name: 'Cuotas Sociales', data: cuotasSociales, esCuotas: true },
    { name: 'Cuotas Escuelita', data: cuotasEscuelita, esCuotas: true },
    { name: 'Cobros', data: cobros },
    { name: 'Escuelita', data: escuelita },
    { name: 'Movimientos', data: movimientos },
    { name: 'Asistencias', data: asistencias },
    { name: 'Muro Libre', data: muroLibre },
    { name: 'Horarios', data: horarios },
    { name: 'Datos', data: datos },
  ];

  for (const tab of tabs) {
    await writeTab(spreadsheetId, tab.name, tab.data.headers, tab.data.rows);
  }
  await writeResumenTab(spreadsheetId, resumenData);

  // Formato: se rehace siempre (no solo al crear la planilla) para que una
  // planilla ya existente reciba también el estilo de pestañas nuevas.
  // clearExistingDecorations evita que charts/reglas se acumulen en cada
  // corrida diaria.
  await clearExistingDecorations(spreadsheetId);
  const formatRequests = [];
  for (const tab of tabs) {
    const sheetId = allSheetIds[tab.name];
    if (sheetId == null) continue;
    formatRequests.push(...buildFormatRequests(
      sheetId,
      tab.data.headers.length,
      tab.esCuotas ? { startCol: tab.data.dataStartCol, endCol: tab.data.dataEndCol, adeudadosCol: tab.data.adeudadosCol } : null,
      tab.name === 'Movimientos' ? tab.data.cierreRowIndices : null,
    ));
  }
  const resumenSheetId = allSheetIds['Resumen'];
  if (resumenSheetId != null) {
    formatRequests.push(...buildResumenFormatAndCharts(resumenSheetId, resumenData));
    formatRequests.push({ updateSheetProperties: { properties: { sheetId: resumenSheetId, tabColor: TAB_COLOR.Resumen }, fields: 'tabColor' } });
  }
  const datosSheetId = allSheetIds['Datos'];
  if (datosSheetId != null) {
    formatRequests.push({ updateSheetProperties: { properties: { sheetId: datosSheetId, tabColor: TAB_COLOR.Datos }, fields: 'tabColor' } });
  }
  if (formatRequests.length > 0) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, resource: { requests: formatRequests } });
  }

  return {
    spreadsheetId,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    stats: {
      socios: socios.rows.length,
      cuotasSociales: cuotasSociales.rows.length,
      cuotasEscuelita: cuotasEscuelita.rows.length,
      cobros: cobros.rows.length,
      escuelita: escuelita.rows.length,
      movimientos: movimientos.rows.length,
      asistencias: asistencias.rows.length,
      muroLibre: muroLibre.rows.length,
      horarios: horarios.rows.length,
      datos: datos.rows.length,
      morosos: resumenData.morosos,
    },
  };
};
