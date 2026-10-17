import mongoose from 'mongoose';
import ItemInventario from '../models/ItemInventario.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { getActor } from '../../../services/getActor.js';

export const deleteItemInventarioHandler = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'ID inválido' });

    const item = await ItemInventario.findOne({ _id: id, clubId: req.user?.clubId, active: true });
    if (!item) return res.status(404).json({ message: 'Ítem no encontrado' });

    const antes = item.toObject();
    item.active = false;
    item.updatedBy = getActor(req);
    await item.save();

    logAudit({ clubId: req.user?.clubId, req, action: 'DELETE', resource: 'ItemInventario', resourceId: item._id, before: antes, after: null });
    res.status(200).json({ message: 'Ítem eliminado' });
  } catch (error) {
    console.error('Error eliminando ítem de inventario:', error);
    res.status(500).json({ message: 'Error al eliminar el ítem' });
  }
};

export default deleteItemInventarioHandler;
