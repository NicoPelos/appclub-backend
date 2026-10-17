import mongoose from 'mongoose';
import ItemInventario from '../models/ItemInventario.js';

export const getItemInventarioHandler = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'ID inválido' });

    const item = await ItemInventario.findOne({ _id: id, clubId: req.user?.clubId, active: true }).lean();
    if (!item) return res.status(404).json({ message: 'Ítem no encontrado' });
    res.status(200).json(item);
  } catch (error) {
    console.error('Error obteniendo ítem de inventario:', error);
    res.status(500).json({ message: 'Error al obtener el ítem' });
  }
};

export default getItemInventarioHandler;
