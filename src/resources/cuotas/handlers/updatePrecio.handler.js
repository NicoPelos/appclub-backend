import mongoose from 'mongoose';
import Precios from '../models/Precios.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { resolverVigenciaPrecio, BusinessError, RequiereConfirmacionError } from '../services/resolverVigenciaPrecio.service.js';
import { getActor } from '../../../services/getActor.js';

/**
 * @openapi
 * /api/precios/{id}:
 *   put:
 *     summary: Actualizar precio (solo admin)
 *     tags: [Precios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               monto: { type: number }
 *               vigenteDesde: { type: string, format: date }
 *               vigenteHasta: { type: string, format: date }
 *               confirmarCierre:
 *                 type: boolean
 *                 description: Si cambiar vigenteDesde/vigenteHasta deja a otro precio de la misma etiqueta sin cerrar, confirma que se cierre automáticamente el día anterior. Sin esto, esa situación devuelve 409 con requiereConfirmacion:true en vez de guardar.
 *     responses:
 *       200:
 *         description: Precio actualizado
 *       400:
 *         description: Datos inválidos
 *       404:
 *         description: Precio no encontrado
 *       409:
 *         description: Fechas ambiguas o superpuestas con otro precio de la misma etiqueta (ver requiereConfirmacion)
 *       500:
 *         description: Error al actualizar precio
 */
export const updatePrecioHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const { monto, vigenteDesde, vigenteHasta, confirmarCierre } = req.body;

    const precioOriginal = await Precios.findOne({ _id: id, clubId: req.user.clubId, active: true });
    if (!precioOriginal) return res.status(404).json({ message: 'Precio no encontrado' });
    const precioAntes = precioOriginal.toObject();

    if (monto !== undefined && (isNaN(Number(monto)) || Number(monto) < 0)) {
      return res.status(400).json({ message: 'monto debe ser un número mayor o igual a 0' });
    }
    let nuevaDesde = precioOriginal.vigenteDesde;
    if (vigenteDesde !== undefined) {
      nuevaDesde = new Date(vigenteDesde);
      if (isNaN(nuevaDesde.getTime())) return res.status(400).json({ message: 'vigenteDesde inválido' });
    }
    let nuevaHasta = precioOriginal.vigenteHasta;
    if (vigenteHasta !== undefined) {
      nuevaHasta = vigenteHasta ? new Date(vigenteHasta) : null;
    }

    const session = await mongoose.startSession();
    let precio;
    try {
      await session.withTransaction(async () => {
        if (vigenteDesde !== undefined || vigenteHasta !== undefined) {
          await resolverVigenciaPrecio({
            clubId: req.user.clubId,
            etiquetaId: precioOriginal.etiquetaId,
            desde: nuevaDesde,
            hasta: nuevaHasta,
            excludeId: precioOriginal._id,
            confirmado: !!confirmarCierre,
            session,
          });
        }

        precio = precioOriginal;
        if (monto !== undefined) precio.monto = Number(monto);
        precio.vigenteDesde = nuevaDesde;
        precio.vigenteHasta = nuevaHasta;
        precio.updatedBy = getActor(req);
        await precio.save({ session });
      });
    } finally {
      session.endSession();
    }

    logAudit({ clubId: req.user?.clubId, req, action: 'UPDATE', resource: 'Precios', resourceId: precio._id, before: precioAntes, after: precio.toObject() });
    return res.status(200).json(precio);
  } catch (error) {
    if (error instanceof RequiereConfirmacionError) {
      return res.status(error.status).json({ requiereConfirmacion: true, message: error.message, precios: error.precios });
    }
    if (error instanceof BusinessError) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error('Error actualizando precio:', error);
    return res.status(500).json({ message: 'Error al actualizar precio' });
  }
};

export default updatePrecioHandler;
