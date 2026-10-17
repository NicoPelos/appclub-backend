import mongoose from 'mongoose';
import Evento from '../models/Evento.js';
import Movimiento from '../../movimientos/models/Movimiento.js';

/**
 * @openapi
 * /api/eventos/{id}/resumen-economico:
 *   get:
 *     summary: Ingresos, egresos y resultado neto de un evento (appcarc-backend#180/#182)
 *     tags: [Eventos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Resumen económico del evento, con el listado completo de movimientos (no paginado)
 *       404:
 *         description: Evento no encontrado
 *       500:
 *         description: Error al calcular el resumen económico
 */
export const getResumenEconomicoEventoHandler = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'ID de evento inválido' });

    const evento = await Evento.findOne({ _id: id, clubId: req.user.clubId, active: true }).lean();
    if (!evento) return res.status(404).json({ message: 'Evento no encontrado' });

    const movimientos = await Movimiento.find({ eventoId: id, clubId: req.user.clubId, active: true })
      .select('type amount concept categoria date paymentMethod sourceType')
      .sort({ date: 1 })
      .lean();

    let totalIngresos = 0;
    let totalEgresos = 0;
    for (const m of movimientos) {
      if (m.type === 'Ingreso') totalIngresos += m.amount;
      else totalEgresos += m.amount;
    }

    return res.status(200).json({
      totalIngresos,
      totalEgresos,
      neto: totalIngresos - totalEgresos,
      movimientos,
    });
  } catch (error) {
    console.error('Error calculando el resumen económico del evento:', error);
    return res.status(500).json({ message: 'Error al calcular el resumen económico' });
  }
};

export default getResumenEconomicoEventoHandler;
