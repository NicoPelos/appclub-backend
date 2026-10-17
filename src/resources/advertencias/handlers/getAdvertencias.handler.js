import Asistencia from '../../asistencias/models/Asistencia.js';
import Advertencia from '../models/Advertencia.js';
import Cuota from '../../cuotas/models/Cuota.js';
import Etiqueta from '../../etiquetas/models/Etiqueta.js';
import Suscripcion from '../../suscripciones/models/Suscripcion.js';
import Escuelita from '../../escuelita/models/Escuelita.js';
import { calcularDeuda } from '../../cuotas/services/calcularDeuda.service.js';
import { ADVERTENCIA } from '../../../constants/advertenciaCodes.js';
import { periodoDeFecha } from '../../../services/fechaArgentina.js';

// Una fila por socio (appcarc-backend#210): casi todas las advertencias son un
// ESTADO ("debe la cuota social"), no un hecho puntual — un socio que entra 3
// veces sin pagar no tiene que aparecer 3 veces ni recibir 3 WhatsApp iguales.
// `items` viene ordenado de más nueva a más vieja, así que la primera vez que
// aparece un código es la más reciente y pisa a las anteriores. LIMITE_SEMANAL
// es un hecho de un día concreto (no se "resuelve" pagando): se conserva cada
// una distinta. Los visitantes sin ficha (sin socioId) no se agrupan. No se
// borra ninguna Asistencia: esto solo cambia cómo se lista.
export const agruparPorSocio = (items) => {
  const porSocio = new Map();
  const agrupados = [];

  for (const item of items) {
    const cuentaIngreso = item.tipo !== 'morosidad' ? 1 : 0;
    const key = item.socioId ? String(item.socioId) : null;
    const existente = key ? porSocio.get(key) : null;

    if (!existente) {
      const nuevo = { ...item, advertencias: [...item.advertencias], ingresos: cuentaIngreso };
      if (key) porSocio.set(key, nuevo);
      agrupados.push(nuevo);
      continue;
    }

    existente.ingresos += cuentaIngreso;
    for (const adv of item.advertencias) {
      const repetida = adv.codigo === ADVERTENCIA.LIMITE_SEMANAL
        ? existente.advertencias.some((a) => a.codigo === adv.codigo && a.mensaje === adv.mensaje)
        : existente.advertencias.some((a) => a.codigo === adv.codigo);
      if (!repetida) existente.advertencias.push(adv);
    }
  }

  return agrupados;
};

const CODIGOS_VALIDOS = Object.values(ADVERTENCIA);
const TIPOS_VALIDOS = ['escuelita', 'muro_libre', 'morosidad'];

// CUOTA_SOCIAL_IMPAGA/CUOTA_IMPAGA/PASE_MENSUAL_IMPAGO quedan congeladas en
// el check-in que las generó — sin re-chequeo, secretaría las vería "sin
// pagar" para siempre aunque el socio ya haya pagado. Se re-evalúan acá
// contra el estado actual de la Cuota para que la lista funcione como
// worklist (desaparece sola a medida que se van pagando). LIMITE_SEMANAL
// queda afuera a propósito: es un hecho puntual de comportamiento, no algo
// que se "pague y resuelva".
//
// CUOTA_IMPAGA (escuelita) no tiene una única etiqueta global — depende del
// plan del socio (X1 vs X2, Adultos, etc.), solo una de esas etiquetas tiene
// uso_sistema 'cuota_escuelita' (appcarc-backend#156). Se resuelve aparte,
// por socio, vía su inscripción activa → plan → etiquetaId.
const USO_SISTEMA_POR_CODIGO = {
  [ADVERTENCIA.CUOTA_SOCIAL_IMPAGA]: 'cuota_social',
  [ADVERTENCIA.PASE_MENSUAL_IMPAGO]: 'muro_libre_mensual_socio',
};

// Mismo período que calculó el flujo de check-in al generar la advertencia.
// Escuelita y muro libre usan los dos la hora argentina (muro libre usaba el
// mes UTC hasta appcarc-backend#283).
const periodoDeAdvertencia = (asistencia) => periodoDeFecha(new Date(asistencia.fecha));

const formatWaPhone = (telefono) => {
  if (!telefono) return null;
  const digits = telefono.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('54')) return digits;
  if (digits.startsWith('0')) return `549${digits.slice(1)}`;
  return `549${digits}`;
};

const formatMonto = (n) => `$${n.toLocaleString('es-AR')}`;

// Todo lo que debe HOY el socio (no solo el ítem puntual que disparó esta
// advertencia) — pedido explícito de Nico: el mensaje de WhatsApp tiene que
// servir para regularizar de una sola vez, no obligar a un ida y vuelta por
// cada tipo de deuda. Mismo cálculo que usa la pantalla de Cuotas.
const buildResumenDeuda = (deuda) => {
  const lineas = [];
  let total = 0;
  for (const s of deuda.suscripciones) {
    if (s.exento || !s.mesesDeuda) continue;
    const conocido = typeof s.totalDeuda === 'number';
    const montoTxt = conocido ? ` — ${formatMonto(s.totalDeuda)}` : '';
    lineas.push(`• ${s.etiqueta?.nombre ?? 'Cuota'}: ${s.mesesDeuda} ${s.mesesDeuda === 1 ? 'mes' : 'meses'}${montoTxt}`);
    if (conocido) total += s.totalDeuda;
  }
  for (const c of deuda.otrosCargos) {
    if (!c.totalDeuda) continue;
    lineas.push(`• ${c.nombre}${c.descripcion ? ` (${c.descripcion})` : ''}: ${formatMonto(c.totalDeuda)}`);
    total += c.totalDeuda;
  }
  return { lineas, total };
};

const buildWaLink = (telefono, nombre, advertencias, resumenDeuda) => {
  const phone = formatWaPhone(telefono);
  if (!phone) return null;

  const bloques = [];
  if (resumenDeuda.lineas.length) {
    bloques.push(`Registramos la siguiente deuda:\n${resumenDeuda.lineas.join('\n')}\nTotal: ${formatMonto(resumenDeuda.total)}`);
  }
  // LIMITE_SEMANAL no es deuda (superó la cantidad de clases de la semana) —
  // el resumen de arriba no lo cubre, se lista aparte.
  const noDeuda = advertencias.filter((a) => a.codigo === ADVERTENCIA.LIMITE_SEMANAL);
  if (noDeuda.length) bloques.push(noDeuda.map((a) => `• ${a.mensaje}`).join('\n'));
  // Si no se pudo calcular la deuda (o ya se pagó justo antes de mandar el
  // mensaje) no se manda un WhatsApp vacío: se cae al texto puntual de siempre.
  if (!bloques.length) bloques.push(advertencias.map((a) => `• ${a.mensaje}`).join('\n'));

  const text = encodeURIComponent(
    `Hola ${nombre}, te contactamos del club.\n${bloques.join('\n\n')}\nPor favor pasate por secretaría para regularizarlo. ¡Gracias!`,
  );
  return `https://wa.me/${phone}?text=${text}`;
};

/**
 * @openapi
 * /api/advertencias:
 *   get:
 *     summary: Listar advertencias, una fila por socio (la más reciente de cada código; LIMITE_SEMANAL se conserva)
 *     tags: [Advertencias]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: dias
 *         schema: { type: integer, default: 30 }
 *         description: Cantidad de días hacia atrás a consultar (máx 365)
 *       - in: query
 *         name: tipo
 *         schema: { type: string, enum: [escuelita, muro_libre, morosidad] }
 *       - in: query
 *         name: codigo
 *         schema: { type: string, enum: [CUOTA_SOCIAL_IMPAGA, CUOTA_IMPAGA, LIMITE_SEMANAL, PASE_MENSUAL_IMPAGO, MOROSIDAD_CUOTA_SOCIAL] }
 *         description: Filtrar por código de advertencia específico
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Lista paginada, una fila por socio. Cada ítem trae `ingresos` (check-ins agrupados) y las advertencias vigentes de ese socio
 *       400:
 *         description: Parámetros inválidos
 *       500:
 *         description: Error al obtener advertencias
 */
export const getAdvertenciasHandler = async (req, res) => {
  try {
    const { clubId } = req.user;
    const { dias = 30, tipo, codigo, page = 1, limit = 20 } = req.query;

    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const diasNum = Math.min(Math.max(parseInt(dias, 10) || 30, 1), 365);

    if (tipo && !TIPOS_VALIDOS.includes(tipo)) {
      return res.status(400).json({ message: 'El tipo debe ser escuelita, muro_libre o morosidad' });
    }
    if (codigo && !CODIGOS_VALIDOS.includes(codigo)) {
      return res.status(400).json({ message: `Código inválido. Válidos: ${CODIGOS_VALIDOS.join(', ')}` });
    }

    const desde = new Date();
    desde.setDate(desde.getDate() - diasNum);

    // Advertencias ligadas a un check-in puntual (escuelita/muro_libre), embebidas en Asistencia.
    let asistenciaItems = [];
    if (!tipo || tipo === 'escuelita' || tipo === 'muro_libre') {
      const filter = {
        clubId,
        active: true,
        'advertencias.0': { $exists: true },
        fecha: { $gte: desde },
      };
      if (tipo) filter.tipo = tipo;
      if (codigo) filter['advertencias.codigo'] = codigo;

      const docs = await Asistencia.find(filter).populate('socioId', 'telefono').sort({ fecha: -1 }).lean();

      const codigosResolubles = [...Object.keys(USO_SISTEMA_POR_CODIGO), ADVERTENCIA.CUOTA_IMPAGA];
      const necesitaChequeo = docs.some((d) => d.advertencias.some((a) => codigosResolubles.includes(a.codigo)));

      let etiquetaIdPorUso = new Map();
      let etiquetaEscuelitaPorSocio = new Map();
      let pagadasSet = new Set();
      const exentasPorSocioEtiqueta = new Map();
      if (necesitaChequeo) {
        const socioIds = [...new Set(docs.filter((d) => d.socioId).map((d) => String(d.socioId._id ?? d.socioId)))];

        const usosSistema = [...new Set(Object.values(USO_SISTEMA_POR_CODIGO))];
        const etiquetas = await Etiqueta.find({ clubId, uso_sistema: { $in: usosSistema }, active: true }).lean();
        etiquetaIdPorUso = new Map(etiquetas.map((e) => [e.uso_sistema, String(e._id)]));

        // CUOTA_IMPAGA no tiene una única etiqueta global — depende del plan
        // de cada socio (X1/X2, Adultos, etc.) — se resuelve por su
        // inscripción activa en escuelita.
        const necesitaEscuelita = docs.some((d) => d.advertencias.some((a) => a.codigo === ADVERTENCIA.CUOTA_IMPAGA));
        if (necesitaEscuelita && socioIds.length) {
          const alumnos = await Escuelita.find({ clubId, socioId: { $in: socioIds }, active: true })
            .populate('planId', 'etiquetaId')
            .select('socioId planId')
            .lean();
          etiquetaEscuelitaPorSocio = new Map(
            alumnos.filter((al) => al.planId?.etiquetaId).map((al) => [String(al.socioId), String(al.planId.etiquetaId)]),
          );
        }

        const etiquetaIds = [...new Set([...etiquetaIdPorUso.values(), ...etiquetaEscuelitaPorSocio.values()])];
        if (socioIds.length && etiquetaIds.length) {
          const cuotasPagadas = await Cuota.find({
            clubId, estado: 'pagada', socioId: { $in: socioIds }, etiquetaId: { $in: etiquetaIds },
          }).select('socioId etiquetaId periodo').lean();
          pagadasSet = new Set(cuotasPagadas.map((c) => `${c.socioId}:${c.etiquetaId}:${c.periodo}`));

          // Un tramo exento (plan "No genera deuda") también resuelve la
          // advertencia: quien no debe pagar nada no tiene nada impago.
          const exentas = await Suscripcion.find({
            clubId, active: true, exento: true, socioId: { $in: socioIds }, etiquetaId: { $in: etiquetaIds },
          }).select('socioId etiquetaId fechaDesde fechaHasta').lean();
          for (const s of exentas) {
            const clave = `${s.socioId}:${s.etiquetaId}`;
            exentasPorSocioEtiqueta.set(clave, [...(exentasPorSocioEtiqueta.get(clave) ?? []), s]);
          }
        }
      }

      asistenciaItems = docs
        .map((doc) => {
          const socioIdStr = doc.socioId ? String(doc.socioId._id ?? doc.socioId) : null;
          const periodo = periodoDeAdvertencia(doc);
          // El filtro de Mongo (?codigo=) solo selecciona documentos con AL
          // MENOS una advertencia de ese código — no descarta las demás del
          // mismo array embebido (un check-in puede acumular varios códigos
          // distintos, ver checkinEscuelita.handler.js). Sin recortar acá,
          // la fila devuelta trae códigos que no se pidieron y el waLink se
          // arma con advertencias ajenas al filtro elegido (appcarc-backend#216).
          const candidatas = codigo ? doc.advertencias.filter((a) => a.codigo === codigo) : doc.advertencias;
          const advertenciasVigentes = candidatas.filter((a) => {
            const etiquetaId = a.codigo === ADVERTENCIA.CUOTA_IMPAGA
              ? (socioIdStr && etiquetaEscuelitaPorSocio.get(socioIdStr))
              : etiquetaIdPorUso.get(USO_SISTEMA_POR_CODIGO[a.codigo] ?? '');
            const esResoluble = a.codigo === ADVERTENCIA.CUOTA_IMPAGA || Boolean(USO_SISTEMA_POR_CODIGO[a.codigo]);
            if (!esResoluble) return true; // no resoluble (ej. LIMITE_SEMANAL): se mantiene siempre
            if (!socioIdStr || !etiquetaId) return true; // sin datos para chequear, no se oculta por las dudas
            if (pagadasSet.has(`${socioIdStr}:${etiquetaId}:${periodo}`)) return false;
            const tramosExentos = exentasPorSocioEtiqueta.get(`${socioIdStr}:${etiquetaId}`) ?? [];
            return !tramosExentos.some((t) => t.fechaDesde <= periodo && (!t.fechaHasta || periodo <= t.fechaHasta));
          });
          if (advertenciasVigentes.length === 0) return null; // ya se resolvieron todas — sale de la worklist

          const telefono = doc.socioId?.telefono ?? null;
          return {
            ...doc,
            advertencias: advertenciasVigentes,
            telefono,
            socioId: doc.socioId?._id ?? doc.socioId,
          };
        })
        .filter((item) => item !== null);
    }

    // Advertencias de estado (morosidad), independientes de check-ins: se muestran
    // mientras sigan abiertas, sin importar cuándo se detectaron (no aplica "dias").
    let morosidadItems = [];
    if ((!tipo || tipo === 'morosidad') && (!codigo || codigo === ADVERTENCIA.MOROSIDAD_CUOTA_SOCIAL)) {
      const docs = await Advertencia.find({ clubId, estado: 'abierta' })
        .populate('socioId', 'telefono')
        .sort({ ultimaRevision: -1 })
        .lean();
      morosidadItems = docs.map((doc) => {
        const telefono = doc.socioId?.telefono ?? null;
        const advertencias = [{ codigo: doc.codigo, mensaje: doc.mensaje }];
        return {
          _id: doc._id,
          tipo: 'morosidad',
          fecha: doc.ultimaRevision,
          nombre: doc.nombre,
          apellido: doc.apellido,
          telefono,
          advertencias,
          socioId: doc.socioId?._id ?? doc.socioId,
        };
      });
    }

    const merged = agruparPorSocio([...asistenciaItems, ...morosidadItems].sort(
      (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime(),
    ));
    const total = merged.length;
    const pagina = merged.slice((pageNumber - 1) * pageSize, (pageNumber - 1) * pageSize + pageSize);

    // La deuda se calcula recién acá (solo para la página que se devuelve, no
    // para toda la ventana de "dias"): es la misma consulta que usa la
    // pantalla de Cuotas, no algo que convenga repetir para filas que ni
    // siquiera se van a mostrar.
    const items = await Promise.all(pagina.map(async (item) => {
      let resumenDeuda = { lineas: [], total: 0 };
      if (item.socioId && item.telefono) {
        try {
          resumenDeuda = buildResumenDeuda(await calcularDeuda({ socioId: item.socioId, clubId }));
        } catch (err) {
          console.error(`No se pudo calcular la deuda para el WhatsApp de advertencia (socio ${item.socioId}):`, err.message);
        }
      }
      return { ...item, waLink: buildWaLink(item.telefono, item.nombre, item.advertencias, resumenDeuda) };
    }));

    return res.status(200).json({
      page: pageNumber,
      limit: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      advertencias: items,
    });
  } catch (error) {
    console.error('Error obteniendo advertencias:', error);
    return res.status(500).json({ message: 'Error al obtener advertencias' });
  }
};
