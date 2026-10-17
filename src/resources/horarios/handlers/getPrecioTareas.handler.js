import Etiqueta from '../../etiquetas/models/Etiqueta.js';

export const getPrecioTareasHandler = async (req, res) => {
  try {
    const etiquetas = await Etiqueta.find({
      clubId: req.user.clubId,
      unidad: 'hora',
      active: true,
    }).sort({ nombre: 1 }).lean();
    res.status(200).json(etiquetas);
  } catch (error) {
    console.error('Error obteniendo tareas por hora:', error);
    res.status(500).json({ message: 'Error al obtener tipos de tarea' });
  }
};
