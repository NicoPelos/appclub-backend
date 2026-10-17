import ItemInventario, { ESTADOS_ITEM } from '../models/ItemInventario.js';
import { escaparRegex } from '../services/itemInventario.service.js';

export const getItemsInventarioHandler = async (req, res) => {
  try {
    const { search, categoria, estado } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

    const filter = { clubId: req.user?.clubId, active: true };
    if (typeof search === 'string' && search.trim()) {
      const re = new RegExp(escaparRegex(search.trim()), 'i');
      filter.$or = [{ nombre: re }, { categoria: re }, { ubicacion: re }];
    }
    if (typeof categoria === 'string' && categoria) filter.categoria = categoria;
    if (typeof estado === 'string' && ESTADOS_ITEM.includes(estado)) filter.estado = estado;

    const [total, items] = await Promise.all([
      ItemInventario.countDocuments(filter),
      ItemInventario.find(filter).sort({ nombre: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);

    res.status(200).json({ page, limit, total, items });
  } catch (error) {
    console.error('Error listando inventario:', error);
    res.status(500).json({ message: 'Error al obtener el inventario' });
  }
};

export default getItemsInventarioHandler;
