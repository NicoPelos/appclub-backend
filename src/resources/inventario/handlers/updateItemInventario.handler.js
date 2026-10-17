import mongoose from 'mongoose';
import ItemInventario from '../models/ItemInventario.js';
import { prepararItem, categoriaExiste } from '../services/itemInventario.service.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { getActor } from '../../../services/getActor.js';

export const updateItemInventarioHandler = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'ID inválido' });

    const { data, error } = prepararItem(req.body, { parcial: true });
    if (error) return res.status(400).json({ message: error });
    if (data.categoria !== undefined && !(await categoriaExiste({ clubId: req.user?.clubId, categoria: data.categoria }))) {
      return res.status(400).json({ message: `La categoría "${data.categoria}" no existe en el inventario` });
    }

    const item = await ItemInventario.findOne({ _id: id, clubId: req.user?.clubId, active: true });
    if (!item) return res.status(404).json({ message: 'Ítem no encontrado' });

    const antes = item.toObject();
    Object.assign(item, data);
    item.updatedBy = getActor(req);
    await item.save();

    logAudit({ clubId: req.user?.clubId, req, action: 'UPDATE', resource: 'ItemInventario', resourceId: item._id, before: antes, after: item.toObject() });
    res.status(200).json(item);
  } catch (error) {
    console.error('Error actualizando ítem de inventario:', error);
    res.status(500).json({ message: 'Error al actualizar el ítem' });
  }
};

export default updateItemInventarioHandler;
