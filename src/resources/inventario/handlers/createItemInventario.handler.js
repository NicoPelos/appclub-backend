import ItemInventario from '../models/ItemInventario.js';
import { prepararItem, categoriaExiste } from '../services/itemInventario.service.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { getActor } from '../../../services/getActor.js';

export const createItemInventarioHandler = async (req, res) => {
  try {
    const { data, error } = prepararItem(req.body);
    if (error) return res.status(400).json({ message: error });
    if (!(await categoriaExiste({ clubId: req.user?.clubId, categoria: data.categoria }))) {
      return res.status(400).json({ message: `La categoría "${data.categoria}" no existe en el inventario` });
    }

    const actor = getActor(req);
    const item = await ItemInventario.create({
      ...data,
      clubId: req.user?.clubId,
      createdBy: actor,
      updatedBy: actor,
    });

    logAudit({ clubId: req.user?.clubId, req, action: 'CREATE', resource: 'ItemInventario', resourceId: item._id, before: null, after: item.toObject() });
    res.status(201).json(item);
  } catch (error) {
    console.error('Error creando ítem de inventario:', error);
    res.status(500).json({ message: 'Error al crear el ítem' });
  }
};

export default createItemInventarioHandler;
