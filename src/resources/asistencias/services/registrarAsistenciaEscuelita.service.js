import mongoose from 'mongoose';
import Asistencia from '../models/Asistencia.js';
import Escuelita from '../../escuelita/models/Escuelita.js';
import Socio from '../../socios/models/Socio.js';
import { esFechaFutura } from '../../../services/fechaArgentina.js';

class BusinessError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'BusinessError';
    this.status = status;
  }
}

export { BusinessError };

export const registrarAsistenciaEscuelita = async ({ clubId, user, body }) => {
  if (!clubId) throw new BusinessError('No se pudo determinar el club del usuario', 401);

  const { socioId, categoria, observaciones, fecha: fechaRaw } = body ?? {};

  if (!socioId) throw new BusinessError('El socioId es obligatorio');
  if (!mongoose.isValidObjectId(socioId)) throw new BusinessError('El socioId no es válido');

  const fecha = fechaRaw ? new Date(fechaRaw) : new Date();
  if (Number.isNaN(fecha.getTime())) throw new BusinessError('La fecha no es válida');
  if (esFechaFutura(fecha)) throw new BusinessError('La fecha de la asistencia no puede ser futura');

  const session = await mongoose.startSession();
  try {
    let resultado;
    await session.withTransaction(async () => {
      const socio = await Socio.findOne({ _id: socioId, clubId, active: true }).session(session);
      if (!socio) throw new BusinessError('El socio no existe, está inactivo o pertenece a otro club', 404);

      const inscripcion = await Escuelita.findOne({
        socioId: socio._id,
        clubId,
        active: true,
      }).session(session);
      if (!inscripcion) throw new BusinessError('El socio no está inscripto activamente en la escuelita', 400);

      const actor = user?.email || user?.id || '';
      const asistencia = new Asistencia({
        clubId,
        tipo: 'escuelita',
        socioId: socio._id,
        nombre: socio.nombre,
        apellido: socio.apellido || '',
        dni: socio.dni || '',
        esSocio: true,
        fecha,
        categoria: String(categoria || '').trim(),
        observaciones: String(observaciones || '').trim(),
        createdBy: actor,
        updatedBy: actor,
      });

      await asistencia.save({ session });
      resultado = asistencia;
    });

    return resultado;
  } finally {
    session.endSession();
  }
};
