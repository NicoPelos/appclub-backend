import mongoose from 'mongoose';
import Movimiento, { CATEGORIAS_MOVIMIENTO } from '../models/Movimiento.js';
import Socio from '../../socios/models/Socio.js';
import Etiqueta from '../../etiquetas/models/Etiqueta.js';
import Asistencia from '../../asistencias/models/Asistencia.js';

const buildDetalle = async (movimientos, clubId) => {
  const socioIds = new Set();
  const etiquetaIds = new Set();
  const asistenciaIds = new Set();

  for (const m of movimientos) {
    if (m.sourceModel === 'Cobro' && m.sourceId?.items) {
      for (const item of m.sourceId.items) {
        if (item.socioId) socioIds.add(String(item.socioId));
        if (item.etiquetaId) etiquetaIds.add(String(item.etiquetaId));
        // item.periodo para una visita de Muro Libre es solo "AAAA-MM" (el
        // helper que lo arma en registrarCobro.service.js está pensado para
        // cuotas mensuales, no guarda el día) — hay que resolver la fecha
        // real vía asistenciaId para saber QUÉ día de Muro Libre fue.
        if (item.asistenciaId) asistenciaIds.add(String(item.asistenciaId));
      }
    }
  }

  // clubId explícito en las tres queries: hoy el invariante "todo sourceId de
  // un Movimiento referencia datos del mismo club" ya lo garantiza
  // registrarCobro.service.js del lado de la escritura, pero cada query acá
  // tiene que defenderse sola igual que el resto del módulo — si ese
  // invariante se relaja en el futuro, esto deja de ser una fuga de datos de
  // otro club (appcarc-backend#138).
  const [socios, etiquetas, asistencias] = await Promise.all([
    socioIds.size
      ? Socio.find({ _id: { $in: [...socioIds] }, clubId }, 'socioNumber nombre apellido dni').lean()
      : [],
    etiquetaIds.size
      ? Etiqueta.find({ _id: { $in: [...etiquetaIds] }, clubId }, 'nombre').lean()
      : [],
    asistenciaIds.size
      ? Asistencia.find({ _id: { $in: [...asistenciaIds] }, clubId }, 'fecha').lean()
      : [],
  ]);

  const socioMap = new Map(socios.map((s) => [String(s._id), s]));
  const etiquetaMap = new Map(etiquetas.map((e) => [String(e._id), e]));
  const asistenciaMap = new Map(asistencias.map((a) => [String(a._id), a]));

  return movimientos.map((m) => {
    let detalle = null;

    if (m.sourceModel === 'Cobro' && m.sourceId?.items) {
      detalle = m.sourceId.items.map((item) => {
        const socio = socioMap.get(String(item.socioId));
        const etiqueta = etiquetaMap.get(String(item.etiquetaId));
        const asistencia = item.asistenciaId ? asistenciaMap.get(String(item.asistenciaId)) : null;
        return {
          socioId: item.socioId,
          socioNumber: socio?.socioNumber || '',
          nombre: socio?.nombre || '',
          apellido: socio?.apellido || '',
          etiqueta: etiqueta?.nombre || '',
          periodo: item.periodo,
          fecha: asistencia?.fecha ?? null,
          amount: item.amount,
        };
      });
    } else if (m.sourceModel === 'Asistencia' && m.sourceId) {
      detalle = [{
        socioId: m.sourceId.socioId || null,
        nombre: m.sourceId.nombre || '',
        apellido: m.sourceId.apellido || '',
        esSocio: m.sourceId.esSocio,
        periodo: m.sourceId.periodo || '',
        fecha: m.sourceId.fecha ?? null,
        tipoPase: m.sourceId.tipoPase || null,
      }];
    }

    // Aparte de `detalle` (para mostrar qué compone el cobro/pago) — ids
    // crudos del Cobro o del EventoParticipante, para poder ofrecer "cambiar
    // forma de pago" (PUT /cobros/:id/forma-pago o
    // PUT /eventos/:eventoId/participantes/:participanteId/pagos/:movimientoId/forma-pago)
    // sin que el frontend dependa de la forma de `sourceId` ya populado (que
    // trae el documento entero, con todos sus campos internos).
    const cobroId = m.sourceModel === 'Cobro' && m.sourceId?._id ? String(m.sourceId._id) : null;
    const participanteId = m.sourceModel === 'EventoParticipante' && m.sourceId?._id ? String(m.sourceId._id) : null;

    return { ...m, detalle, cobroId, participanteId };
  });
};

/**
 * @openapi
 * /api/movimientos:
 *   get:
 *     summary: Obtener lista de movimientos
 *     tags: [Movimientos]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *         required: false
 *         description: Número de página
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *         required: false
 *         description: Cantidad de resultados por página
 *       - in: query
 *         name: socioId
 *         schema:
 *           type: string
 *         required: false
 *         description: Filtrar movimientos de un socio en particular (solo cobros/muro libre de un único socio)
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         required: false
 *         description: Buscar por concepto, responsable o nombre de socio (case-insensitive)
 *       - in: query
 *         name: paymentMethod
 *         schema:
 *           type: string
 *           enum: [Efectivo, Transferencia, MercadoPago]
 *         required: false
 *         description: Filtrar por medio de pago
 *       - in: query
 *         name: categoria
 *         schema:
 *           type: string
 *         required: false
 *         description: Filtrar por categoría (solo aplica a movimientos cargados a mano — ver CATEGORIAS_MOVIMIENTO)
 *       - in: query
 *         name: desde
 *         schema:
 *           type: string
 *           example: "2026-01-01"
 *         required: false
 *         description: Fecha desde (incluida), formato YYYY-MM-DD
 *       - in: query
 *         name: hasta
 *         schema:
 *           type: string
 *           example: "2026-01-31"
 *         required: false
 *         description: Fecha hasta (incluida), formato YYYY-MM-DD
 *     responses:
 *       200:
 *         description: Lista de movimientos obtenida exitosamente
 *       500:
 *         description: Error al obtener movimientos
 */

export const getMovimientosHandler = async (req, res) => {
  try {
    const { page = 1, limit = 20, trash, type, paymentMethod, socioId, search, categoria, desde, hasta } = req.query;
    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const showTrash = trash === 'true';
    const filter = { clubId: req.user?.clubId, active: !showTrash };
    if (type && ['Ingreso', 'Egreso'].includes(type)) filter.type = type;
    if (paymentMethod && ['Efectivo', 'Transferencia', 'MercadoPago'].includes(paymentMethod)) filter.paymentMethod = paymentMethod;
    if (socioId && typeof socioId === 'string' && mongoose.Types.ObjectId.isValid(socioId)) filter.socioId = socioId;
    if (categoria && [...CATEGORIAS_MOVIMIENTO.Ingreso, ...CATEGORIAS_MOVIMIENTO.Egreso].includes(categoria)) filter.categoria = categoria;

    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ concept: regex }, { responsable: regex }, { socioNombre: regex }];
    }

    if (desde || hasta) {
      filter.date = {};
      if (desde) filter.date.$gte = new Date(`${desde}T00:00:00.000Z`);
      if (hasta) filter.date.$lte = new Date(`${hasta}T23:59:59.999Z`);
    }

    const [total, movimientosRaw, subtotalesAgg] = await Promise.all([
      Movimiento.countDocuments(filter),
      Movimiento.find(filter)
        .sort({ date: -1 })
        .skip((pageNumber - 1) * pageSize)
        .limit(pageSize)
        // appcarc-backend#183: sin el match acá, populate resuelve sourceId
        // (Cobro/Asistencia/EventoParticipante vía refPath) sin ningún
        // filtro propio — hoy no es explotable porque el invariante "todo
        // sourceId referencia datos del mismo club" se sostiene del lado de
        // la escritura, pero esta query tiene que defenderse sola igual que
        // buildDetalle más abajo (mismo criterio, appcarc-backend#138).
        .populate({ path: 'sourceId', match: { clubId: req.user?.clubId } })
        .lean(),
      // Subtotal por medio de pago sobre TODO lo que matchea el filtro, no
      // solo la página visible — para auditar caja (ej. "cuánto de esto es
      // Efectivo vs Transferencia") hace falta el total real, no una muestra.
      Movimiento.aggregate([
        { $match: filter },
        { $group: { _id: { paymentMethod: '$paymentMethod', type: '$type' }, total: { $sum: '$amount' } } },
      ]),
    ]);

    const movimientos = await buildDetalle(movimientosRaw, req.user?.clubId);

    const subtotalesPorMedioPago = {};
    for (const { _id, total: montoTotal } of subtotalesAgg) {
      const pm = _id.paymentMethod;
      subtotalesPorMedioPago[pm] = subtotalesPorMedioPago[pm] || { Ingreso: 0, Egreso: 0 };
      subtotalesPorMedioPago[pm][_id.type] = montoTotal;
    }

    res.status(200).json({
      page: pageNumber,
      limit: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      movimientos,
      subtotalesPorMedioPago,
    });
  } catch (error) {
    console.error('Error obteniendo movimientos:', error);
    res.status(500).json({ message: 'Error al obtener movimientos' });
  }
};

/**
 * @openapi
 * /api/movimientos/{id}:
 *   get:
 *     summary: Obtener un movimiento por id
 *     description: Misma forma que cada ítem del listado (con `detalle`, `cobroId`, `participanteId`). Sirve para abrir el movimiento asociado a un cobro desde la ficha del socio.
 *     tags: [Movimientos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Movimiento encontrado
 *       400:
 *         description: Id inválido
 *       404:
 *         description: Movimiento no encontrado (o de otro club)
 *       500:
 *         description: Error al obtener el movimiento
 */
export const getMovimientoByIdHandler = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Id de movimiento inválido' });
    }

    const raw = await Movimiento.findOne({ _id: id, clubId: req.user?.clubId })
      .populate({ path: 'sourceId', match: { clubId: req.user?.clubId } })
      .lean();
    if (!raw) return res.status(404).json({ message: 'Movimiento no encontrado' });

    const [movimiento] = await buildDetalle([raw], req.user?.clubId);
    return res.status(200).json(movimiento);
  } catch (error) {
    console.error('Error obteniendo movimiento:', error);
    return res.status(500).json({ message: 'Error al obtener el movimiento' });
  }
};
