import mongoose from 'mongoose';
import Movimiento, { CATEGORIAS_MOVIMIENTO } from '../models/Movimiento.js';
import Evento from '../../eventos/models/Evento.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { getActor } from '../../../services/getActor.js';

const VALID_PAYMENT_METHODS = ['Efectivo', 'Transferencia'];

/**
 * @openapi
 * /api/movimientos/{id}:
 *   put:
 *     summary: Actualizar un movimiento de caja
 *     tags: [Movimientos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del movimiento
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [Ingreso, Egreso]
 *               amount:
 *                 type: number
 *               concept:
 *                 type: string
 *               categoria:
 *                 type: string
 *               paymentMethod:
 *                 type: string
 *                 enum: [Efectivo, Transferencia]
 *               description:
 *                 type: string
 *               date:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       200:
 *         description: Movimiento actualizado exitosamente
 *       400:
 *         description: Error en los datos enviados
 *       404:
 *         description: Movimiento no encontrado
 *       500:
 *         description: Error al actualizar movimiento
 */
export const updateMovimientoHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const { type, amount, concept, categoria, paymentMethod, description, date, eventoId } = req.body;

    const movimiento = await Movimiento.findOne({ _id: id, clubId: req.user?.clubId, active: true });
    if (!movimiento) return res.status(404).json({ message: 'Movimiento no encontrado' });
    const movimientoAntes = movimiento.toObject();

    // Los movimientos de cobro/muro_libre reflejan plata ya registrada en
    // otro documento (Cobro.total, Cuota.montoPagadoSnapshot, etc.) — editar
    // type/amount/paymentMethod acá los desincroniza de su origen sin dejar
    // rastro de por qué difieren. Solo se puede tocar description/date.
    if (movimiento.sourceType !== 'manual' && (type !== undefined || amount !== undefined || paymentMethod !== undefined)) {
      return res.status(400).json({ message: 'Este movimiento se generó automáticamente — solo se puede editar la descripción y la fecha' });
    }

    // Un movimiento con pagos de Mercado Pago vinculados (Ingreso o Egreso) no
    // puede cambiar de tipo ni pasar a Efectivo — el vínculo dejaría de tener
    // sentido. Editar el resto de los campos sí está permitido.
    if (movimiento.mercadopagoVinculos.length > 0) {
      const cambiaTipo = type !== undefined && type !== movimiento.type;
      const pasaAEfectivo = (paymentMethod ?? movimiento.paymentMethod) === 'Efectivo';
      if (cambiaTipo || pasaAEfectivo) {
        return res.status(400).json({ message: 'Este movimiento tiene pagos de Mercado Pago vinculados — no se puede cambiar el tipo ni pasar a Efectivo. Desvinculá los pagos primero.' });
      }
    }

    if (type !== undefined && !['Ingreso', 'Egreso'].includes(type)) {
      return res.status(400).json({ message: 'Tipo de movimiento inválido' });
    }

    if (amount !== undefined && (typeof amount !== 'number' || amount <= 0)) {
      return res.status(400).json({ message: 'El importe debe ser un número mayor que cero' });
    }

    if (concept !== undefined && (typeof concept !== 'string' || !concept.trim())) {
      return res.status(400).json({ message: 'El concepto no puede estar vacío' });
    }

    // Categoría es obligatoria solo para movimientos manuales (los de cobro/muro_libre
    // nunca la tienen ni la necesitan) — si el movimiento ya tiene una categoría
    // (o se la están poniendo ahora), se valida contra la lista del type efectivo.
    const tipoEfectivo = type ?? movimiento.type;
    if (categoria !== undefined && !CATEGORIAS_MOVIMIENTO[tipoEfectivo].includes(categoria)) {
      return res.status(400).json({ message: `La categoría debe ser una de: ${CATEGORIAS_MOVIMIENTO[tipoEfectivo].join(', ')}` });
    }
    if (movimiento.categoria && categoria === undefined && type !== undefined && type !== movimiento.type) {
      return res.status(400).json({ message: 'Al cambiar el tipo de un movimiento con categoría, indicá la nueva categoría' });
    }

    if (paymentMethod !== undefined && !VALID_PAYMENT_METHODS.includes(paymentMethod)) {
      return res.status(400).json({ message: 'La forma de pago debe ser Efectivo o Transferencia' });
    }

    if (date !== undefined) {
      const d = new Date(date);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ message: 'La fecha del movimiento es inválida' });
      }
      movimiento.date = d;
    }

    // eventoId es independiente de sourceType — taguear (o destaguear) a qué
    // evento pertenece un movimiento no toca su plata/origen, así que se
    // permite incluso en movimientos generados automáticamente (ej. "este
    // cobro en realidad era del viaje", appcarc-backend#180).
    if (eventoId !== undefined) {
      if (eventoId === null) {
        movimiento.eventoId = null;
      } else {
        if (!mongoose.Types.ObjectId.isValid(eventoId)) {
          return res.status(400).json({ message: 'eventoId inválido' });
        }
        const evento = await Evento.findOne({ _id: eventoId, clubId: req.user?.clubId, active: true });
        if (!evento) return res.status(404).json({ message: 'Evento no encontrado' });
        movimiento.eventoId = evento._id;
      }
    }

    if (type !== undefined) movimiento.type = type;
    if (amount !== undefined) movimiento.amount = amount;
    if (concept !== undefined) movimiento.concept = concept.trim();
    if (categoria !== undefined) movimiento.categoria = categoria;
    if (paymentMethod !== undefined) movimiento.paymentMethod = paymentMethod;
    if (description !== undefined) movimiento.description = description;
    movimiento.updatedBy = getActor(req);

    await movimiento.save();
    logAudit({ clubId: req.user?.clubId, req, action: 'UPDATE', resource: 'Movimiento', resourceId: movimiento._id, before: movimientoAntes, after: movimiento.toObject() });
    res.status(200).json(movimiento);
  } catch (error) {
    console.error('Error actualizando movimiento:', error);
    res.status(500).json({ message: 'Error al actualizar movimiento' });
  }
};
