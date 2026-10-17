import Cobro from '../models/Cobro.js';
import Movimiento from '../../movimientos/models/Movimiento.js';

/**
 * @openapi
 * components:
 *   schemas:
 *     CobroResponse:
 *       type: object
 *       properties:
 *         page:
 *           type: integer
 *           description: Número de página actual
 *         limit:
 *           type: integer
 *           description: Cantidad de ítems por página
 *         total:
 *           type: integer
 *           description: Total de cobros encontrados
 *         totalPages:
 *           type: integer
 *           description: Total de páginas disponibles
 *         cobros:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Cobro'
 *     Cobro:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           description: ID del cobro
 *         clubId:
 *           type: string
 *           description: ID del club asociado
 *         responsable:
 *           type: string
 *           description: Responsable del cobro (nombre o email)
 *         paymentMethod:
 *           type: string
 *           enum: [Efectivo, Transferencia]
 *         totalAmount:
 *           type: number
 *           description: Monto total del cobro
 *         description:
 *           type: string
 *           nullable: true
 *         date:
 *           type: string
 *           format: date-time
 *         items:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/CobroItem'
 *         createdAt:
 *           type: string
 *           format: date-time
 *     CobroItem:
 *       type: object
 *       properties:
 *         socioId:
 *           type: string
 *         suscripcionId:
 *           type: string
 *         etiquetaId:
 *           type: string
 *         periodo:
 *           type: string
 *           pattern: '^\d{4}-(0[1-9]|1[0-2])$'
 *           example: "2026-06"
 *         amount:
 *           type: number
 *         precioSugeridoSnapshot:
 *           type: number
 *           nullable: true
 *         precioCodigo:
 *           type: string
 *         description:
 *           type: string
 */

// appcarc-backend#266: el pago de un evento NUNCA crea un Cobro (pasa por
// registrarPagoEventoParticipante, que registra el Movimiento directo —
// ver el comentario grande en ese service) así que quedaba invisible acá,
// aunque el dinero se haya movido bien. Se arma un item con forma de Cobro
// (mismo contrato que ya consume el frontend: items[].socioId, paymentMethod,
// totalAmount, date, active) para no tener que tocar los clientes.
const movimientoEventoComoCobro = (m) => ({
  _id: m._id,
  clubId: m.clubId,
  responsable: m.responsable,
  paymentMethod: m.paymentMethod,
  totalAmount: m.amount,
  description: m.eventoId?.nombre ? `Evento: ${m.eventoId.nombre}` : m.concept,
  date: m.date,
  active: m.active,
  createdAt: m.createdAt,
  items: [{ socioId: m.socioId }],
  tipo: 'evento',
});

export const getCobrosHandler = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const filter = { clubId: req.user?.clubId, active: true };

    // Alcance a un socio o grupo chico de socios (autoservicio: propio perfil
    // + hijos vinculados; o un socio puntual que pide staff) — acá sí se
    // suman los pagos de evento. La vista general del club (sin alcance) se
    // deja intacta: solo Cobro, paginado en la base, para no traer el
    // historial completo de Movimientos de evento del club entero a memoria.
    let socioScope = null;
    if (req.accessibleSocioIds) {
      // Autoservicio (ver authorizeSelfYVinculadosOr): propio perfil + hijos vinculados.
      filter['items.socioId'] = { $in: [...req.accessibleSocioIds] };
      socioScope = [...req.accessibleSocioIds];
    } else if (req.query.socioId) {
      filter['items.socioId'] = req.query.socioId;
      socioScope = [req.query.socioId];
    }

    if (!socioScope) {
      const [total, cobros] = await Promise.all([
        Cobro.countDocuments(filter),
        Cobro.find(filter)
          .sort({ date: -1, createdAt: -1 })
          .skip((pageNumber - 1) * pageSize)
          .limit(pageSize)
          .populate('items.socioId', 'socioNumber nombre apellido dni')
          .populate('items.etiquetaId', 'nombre'),
      ]);

      return res.status(200).json({
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        cobros,
      });
    }

    // Volumen chico (el historial de pagos de un puñado de socios, no del
    // club entero) — se trae todo de las dos fuentes y se pagina en memoria
    // sobre la lista ya mezclada y ordenada.
    const [cobros, eventoMovimientos] = await Promise.all([
      Cobro.find(filter)
        .populate('items.socioId', 'socioNumber nombre apellido dni')
        .populate('items.etiquetaId', 'nombre')
        .lean(),
      Movimiento.find({
        clubId: req.user?.clubId,
        active: true,
        sourceType: 'evento_participante',
        socioId: { $in: socioScope },
      })
        .populate('eventoId', 'nombre')
        .lean(),
    ]);

    const merged = [
      ...cobros.map((c) => ({ ...c, tipo: 'cobro' })),
      ...eventoMovimientos.map(movimientoEventoComoCobro),
    ].sort((a, b) => new Date(b.date) - new Date(a.date) || new Date(b.createdAt) - new Date(a.createdAt));

    const total = merged.length;
    const pagina = merged.slice((pageNumber - 1) * pageSize, (pageNumber - 1) * pageSize + pageSize);

    res.status(200).json({
      page: pageNumber,
      limit: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      cobros: pagina,
    });
  } catch (error) {
    console.error('Error obteniendo cobros:', error);
    res.status(500).json({ message: 'Error al obtener cobros' });
  }
};

export default getCobrosHandler;
