import Asistencia from '../models/Asistencia.js';
import { getActor } from '../../../services/getActor.js';

export const deleteAsistenciaHandler = async (req, res) => {
  try {
    // Restringido a escuelita a propósito (appcarc-backend#219): anular acá
    // un check-in de muro_libre dejaría el Movimiento/Cobro y la Cuota del
    // pase mensual asociados activos (sin la cascada que sí aplica
    // deleteMuroLibreHandler) — usar /api/muro-libre/:id para esos.
    const asistencia = await Asistencia.findOneAndUpdate(
      { _id: req.params.id, clubId: req.user?.clubId, tipo: 'escuelita', active: true },
      { active: false, updatedBy: getActor(req) },
      { returnDocument: 'after' },
    );
    if (!asistencia) {
      return res.status(404).json({ message: 'Asistencia no encontrada' });
    }
    res.status(200).json({ message: 'Asistencia eliminada' });
  } catch (error) {
    console.error('Error eliminando asistencia:', error);
    res.status(500).json({ message: 'Error al eliminar asistencia' });
  }
};

export default deleteAsistenciaHandler;
