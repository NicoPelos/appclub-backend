import mongoose from 'mongoose';
import Movimiento, { CATEGORIAS_MOVIMIENTO } from '../models/Movimiento.js';
import Evento from '../../eventos/models/Evento.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { getActor } from '../../../services/getActor.js';

const VALID_PAYMENT_METHODS = ['Efectivo', 'Transferencia'];

/**
 * @openapi
 * /api/movimientos:
 *   post:
 *     summary: Crear un nuevo movimiento
 *     tags: [Movimientos]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/MovimientoCreateRequest'
 *     responses:
 *       201:
 *         description: Movimiento creado exitosamente
 *       400:
 *         description: Error en los datos enviados para crear el movimiento
 *       500:
 *         description: Error al crear movimiento
 *
 * components:
 *   schemas:
 *     MovimientoCreateRequest:
 *       type: object
 *       required:
 *         - type
 *         - amount
 *         - concept
 *         - categoria
 *         - responsable
 *         - paymentMethod
 *       properties:
 *         type:
 *           type: string
 *           enum: [Ingreso, Egreso]
 *           description: Tipo de movimiento (Ingreso o Egreso)
 *         amount:
 *           type: number
 *           minimum: 0
 *           description: Importe del movimiento
 *         concept:
 *           type: string
 *           description: Concepto del movimiento
 *         categoria:
 *           type: string
 *           description: 'Categoría — depende de type. Ingreso: Viajes, Eventos, Ventas / Reventa, Subsidios / Donaciones, Otros. Egreso: Honorarios, Costos Fijos, Varios.'
 *         responsable:
 *           type: string
 *           description: Quién gestiona/autoriza el movimiento (no a nombre de quién es el ingreso/egreso)
 *         paymentMethod:
 *           type: string
 *           enum: [Efectivo, Transferencia]
 *           description: Forma de pago del movimiento
 *         socioNombre:
 *           type: string
 *           description: A nombre de quién es el movimiento, si corresponde (opcional)
 *         description:
 *           type: string
 *           description: Descripción adicional del movimiento (opcional)
 *         date:
 *           type: string
 *           format: date-time
 *           description: Fecha del movimiento (opcional)
 */ 

export const createMovimientoHandler = async (req, res) => {
  try {
    const {
      type,
      amount,
      concept,
      categoria,
      responsable,
      paymentMethod,
      socioNombre,
      description,
      date,
      eventoId,
    } = req.body;

    if (!type || !['Ingreso', 'Egreso'].includes(type)) {
      return res.status(400).json({ message: 'Tipo de movimiento inválido' });
    }

    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ message: 'El importe debe ser un número mayor que cero' });
    }

    if (!concept?.trim()) {
      return res.status(400).json({ message: 'El concepto es obligatorio' });
    }

    if (!categoria || !CATEGORIAS_MOVIMIENTO[type].includes(categoria)) {
      return res.status(400).json({ message: `La categoría debe ser una de: ${CATEGORIAS_MOVIMIENTO[type].join(', ')}` });
    }

    if (!responsable?.trim()) {
      return res.status(400).json({ message: 'El responsable es obligatorio' });
    }

    if (!paymentMethod || !VALID_PAYMENT_METHODS.includes(paymentMethod)) {
      return res.status(400).json({ message: 'La forma de pago debe ser Efectivo o Transferencia' });
    }

    const movementDate = date ? new Date(date) : new Date();
    if (Number.isNaN(movementDate.getTime())) {
      return res.status(400).json({ message: 'La fecha del movimiento es inválida' });
    }

    let eventoIdValidado = null;
    if (eventoId) {
      if (!mongoose.Types.ObjectId.isValid(eventoId)) {
        return res.status(400).json({ message: 'eventoId inválido' });
      }
      const evento = await Evento.findOne({ _id: eventoId, clubId: req.user.clubId, active: true });
      if (!evento) return res.status(404).json({ message: 'Evento no encontrado' });
      eventoIdValidado = evento._id;
    }

    const movimiento = new Movimiento({
      clubId: req.user.clubId,
      userId: req.user.id,
      responsable: responsable.trim(),
      type,
      amount,
      concept: concept.trim(),
      categoria,
      paymentMethod,
      socioNombre: socioNombre || '',
      description: description || '',
      date: movementDate,
      eventoId: eventoIdValidado,
      createdBy: getActor(req),
      updatedBy: getActor(req),
    });

    await movimiento.save();
    logAudit({ clubId: req.user?.clubId, req, action: 'CREATE', resource: 'Movimiento', resourceId: movimiento._id, before: null, after: movimiento.toObject() });
    res.status(201).json(movimiento);
  } catch (error) {
    console.error('Error creando movimiento:', error);
    res.status(500).json({ message: 'Error al crear movimiento' });
  }
};
