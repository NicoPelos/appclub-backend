import Etiqueta from '../../etiquetas/models/Etiqueta.js';
import Cobro from '../../cobros/models/Cobro.js';
import Movimiento, { CATEGORIAS_MOVIMIENTO } from '../models/Movimiento.js';

// Compartido entre el export a Google Sheets (sheetsExport.service.js,
// pestaña Resumen) y GET /api/movimientos/resumen-por-categoria — antes esta
// lógica vivía privada dentro de sheetsExport.service.js, atada a un rango
// fijo de 12 meses; se extrajo para poder pedir cualquier rango de fechas
// desde una pantalla (ver appCARC-web Dashboard, "Ingresos por categoría").

// Mapa {etiquetaId: {nombre, uso_sistema}} de todas las etiquetas del club —
// lo usan Cobros (para saber qué se cobró en cada item), Datos y Resumen.
export const getEtiquetaMap = async (clubId) => {
  const etiquetas = await Etiqueta.find({ clubId }).lean();
  const map = {};
  for (const e of etiquetas) map[e._id.toString()] = { nombre: e.nombre, uso_sistema: e.uso_sistema };
  return map;
};

// Categoriza un item de Cobro (siempre tiene etiquetaId) por su uso_sistema o,
// si no matchea nada específico, por si el nombre de la etiqueta menciona
// "adultos" (las clases de adultos son Suscripcion normales, no tienen un
// uso_sistema propio distinto de escuelita hoy).
//
// BUG histórico corregido acá (2026-09-09): el parámetro se llamaba
// `usoSistema` (camelCase) pero getEtiquetaMap (y por lo tanto TODOS los
// callers reales) siempre pasan `uso_sistema` (snake_case, igual que el
// modelo Etiqueta) — quedaba siempre undefined → default '', así que
// NINGÚN item de Cobro categorizaba nunca por uso_sistema. "Cuota Social"
// y "Muro Libre" pagados vía Registrar Cobro (no en el momento del
// check-in) caían siempre en "Otros"; "Escuela Niños"/"Escuela Adultos"
// se salvaban a medias porque además matchean por el nombre de la
// etiqueta. Nunca se notó porque este cálculo solo alimentaba el export a
// Sheets — nadie llegó a auditar el desglose ítem por ítem hasta ahora.
export const categoriaIngresoPorEtiqueta = ({ nombre = '', uso_sistema = '' }) => {
  const usoSistema = uso_sistema || '';
  if (usoSistema === 'cuota_social') return 'Cuota Social';
  if (/adultos/i.test(nombre)) return 'Escuela Adultos';
  // No solo la etiqueta con uso_sistema 'cuota_escuelita' — hay otras por
  // plan (X1 vs X2, appcarc-backend#156) que no tienen ese uso_sistema
  // seteado, pero sí dicen "escuelita" en el nombre.
  if (usoSistema === 'cuota_escuelita' || /escuelita/i.test(nombre)) return 'Escuela Niños';
  if (usoSistema.startsWith('muro_libre')) return 'Muro Libre';
  return 'Otros';
};

// Los ingresos/egresos cargados a mano (sourceType:'manual') ya tienen un
// campo Movimiento.categoria real (issue #55) — se usa directo. Estas dos
// funciones de palabras clave quedan solo como red de seguridad para
// registros viejos que quedaron sin categoria por algún motivo (no debería
// pasar después del backfill, pero mejor no perder esa plata del resumen si
// pasa).
export const categoriaIngresoManual = (m) => {
  if (m.categoria) return m.categoria;
  const c = (m.concept || '').toLowerCase();
  if (/trekking|treking|treeking|viaje/.test(c)) return 'Viajes';
  if (/muro|boulder/.test(c)) return 'Muro Libre';
  if (/adulto/.test(c)) return 'Escuela Adultos';
  if (/clases?\s*ni|escuelita|juvenil/.test(c)) return 'Escuela Niños';
  if (/cuota social/.test(c)) return 'Cuota Social';
  return 'Otros';
};

export const categoriaEgresoManual = (m) => {
  if (m.categoria) return m.categoria;
  const c = (m.concept || '').toLowerCase();
  if (/honorario/.test(c)) return 'Honorarios';
  if (/alquiler|epec|federaci[oó]n patronal|federaci[oó]n andinista|impuesto/.test(c)) return 'Costos Fijos';
  return 'Varios';
};

export const CATEGORIAS_INGRESO = [
  'Cuota Social', 'Escuela Niños', 'Escuela Adultos', 'Muro Libre',
  ...CATEGORIAS_MOVIMIENTO.Ingreso,
];
export const CATEGORIAS_EGRESO = [...CATEGORIAS_MOVIMIENTO.Egreso];

const sumarEn = (map, key, monto) => { map[key] = (map[key] || 0) + (monto || 0); };

// Núcleo compartido por buildIngresosEgresosPorCategoria (solo totales) y
// buildDetalleCategoria (appcarc-backend#171, listado item por item para
// poder auditar de dónde sale cada categoría) — hace las mismas dos
// consultas y clasifica cada entrada una sola vez, `onEntry` decide qué
// hacer con cada una (sumar, o filtrar y guardar).
//
// `hasta` es opcional (sin tope superior) para no romper al caller original
// (sheetsExport.service.js, ventana fija de 12 meses hacia atrás desde hoy).
const recorrerMovimientosPorCategoria = async ({ clubId, desde, hasta, etiquetaMap }, onEntry) => {
  const dateFilter = { $gte: desde };
  if (hasta) dateFilter.$lte = hasta;

  const movimientos = await Movimiento.find({ clubId, active: true, date: dateFilter })
    .select('type sourceType sourceId concept categoria amount date socioNombre paymentMethod')
    .lean();

  const cobroIds = movimientos.filter((m) => m.sourceType === 'cobro' && m.sourceId).map((m) => m.sourceId);
  const cobros = cobroIds.length
    ? await Cobro.find({ _id: { $in: cobroIds }, clubId }).select('items').lean()
    : [];
  const cobroMap = Object.fromEntries(cobros.map((c) => [c._id.toString(), c]));

  for (const m of movimientos) {
    if (m.type === 'Ingreso') {
      if (m.sourceType === 'cobro') {
        const cobro = cobroMap[m.sourceId?.toString()];
        if (cobro) {
          for (const item of cobro.items) {
            const etiqueta = etiquetaMap[item.etiquetaId?.toString()] || {};
            onEntry({
              tipo: 'Ingreso',
              categoria: categoriaIngresoPorEtiqueta(etiqueta),
              monto: item.amount || 0,
              fecha: m.date,
              movimientoId: m._id,
              socioNombre: m.socioNombre,
              concepto: etiqueta.nombre || m.concept,
              paymentMethod: m.paymentMethod,
            });
          }
        }
      } else if (m.sourceType === 'muro_libre') {
        onEntry({
          tipo: 'Ingreso', categoria: 'Muro Libre', monto: m.amount || 0, fecha: m.date,
          movimientoId: m._id, socioNombre: m.socioNombre, concepto: m.concept, paymentMethod: m.paymentMethod,
        });
      } else {
        onEntry({
          tipo: 'Ingreso', categoria: categoriaIngresoManual(m), monto: m.amount || 0, fecha: m.date,
          movimientoId: m._id, socioNombre: m.socioNombre, concepto: m.concept, paymentMethod: m.paymentMethod,
        });
      }
    } else if (m.type === 'Egreso') {
      onEntry({
        tipo: 'Egreso', categoria: categoriaEgresoManual(m), monto: m.amount || 0, fecha: m.date,
        movimientoId: m._id, socioNombre: m.socioNombre, concepto: m.concept, paymentMethod: m.paymentMethod,
      });
    }
  }
};

export const buildIngresosEgresosPorCategoria = async ({ clubId, desde, hasta, etiquetaMap }) => {
  const ingresos = Object.fromEntries(CATEGORIAS_INGRESO.map((c) => [c, 0]));
  const egresos = Object.fromEntries(CATEGORIAS_EGRESO.map((c) => [c, 0]));

  await recorrerMovimientosPorCategoria({ clubId, desde, hasta, etiquetaMap }, (entry) => {
    sumarEn(entry.tipo === 'Ingreso' ? ingresos : egresos, entry.categoria, entry.monto);
  });

  return {
    ingresos: CATEGORIAS_INGRESO.map((c) => [c, ingresos[c]]),
    egresos: CATEGORIAS_EGRESO.map((c) => [c, egresos[c]]),
  };
};

// Listado item por item de una sola categoría — para el detalle que se abre
// al hacer click en una porción de la torta o una barra del gráfico mes a
// mes en el Dashboard (appcarc-backend#171), en vez de quedarse solo con el
// total agregado.
export const buildDetalleCategoria = async ({ clubId, tipo, categoria, desde, hasta, etiquetaMap }) => {
  const detalle = [];
  await recorrerMovimientosPorCategoria({ clubId, desde, hasta, etiquetaMap }, (entry) => {
    if (entry.tipo === tipo && entry.categoria === categoria) detalle.push(entry);
  });
  return detalle.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
};
