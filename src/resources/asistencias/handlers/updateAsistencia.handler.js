import Asistencia from '../models/Asistencia.js';
import { esFechaFutura } from '../../../services/fechaArgentina.js';
import { getActor } from '../../../services/getActor.js';

export const updateAsistenciaHandler = async (req, res) => {
  try {
    const { observaciones, categoria, fecha } = req.body;
    const updates = { updatedBy: getActor(req) };
    if (observaciones !== undefined) updates.observaciones = String(observaciones).trim();
    if (categoria !== undefined) updates.categoria = String(categoria).trim();
    if (fecha !== undefined) {
      const d = new Date(fecha);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ message: 'La fecha es inválida' });
      if (esFechaFutura(d)) return res.status(400).json({ message: 'La fecha de la asistencia no puede ser futura' });
      updates.fecha = d;
    }

    // Restringido a escuelita a propósito (appcarc-backend#219): muro_libre
    // tiene su propio CRUD dedicado en /api/muro-libre/:id, protegido por
    // MURO_LIBRE_WRITE (que ASISTENCIAS_WRITE no implica) y con su propia
    // cascada de cobro/cuota que esta ruta genérica no replica.
    const asistencia = await Asistencia.findOneAndUpdate(
      { _id: req.params.id, clubId: req.user?.clubId, tipo: 'escuelita', active: true },
      updates,
      { returnDocument: 'after' },
    );
    if (!asistencia) {
      return res.status(404).json({ message: 'Asistencia no encontrada' });
    }
    res.status(200).json(asistencia);
  } catch (error) {
    console.error('Error actualizando asistencia:', error);
    res.status(500).json({ message: 'Error al actualizar asistencia' });
  }
};

export default updateAsistenciaHandler;
