import Club from '../../clubs/models/Club.js';
import { invalidarClubActivo } from '../../../services/clubActivoCache.js';

export const suspendClubHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const { activo } = req.body ?? {};

    const club = await Club.findById(id);
    if (!club) return res.status(404).json({ message: 'Club no encontrado' });

    // Con `activo` explícito el resultado es el mismo aunque el request se
    // repita (appcarc-backend#242). Sin él se mantiene el toggle histórico,
    // pero con la condición del estado actual: dos requests simultáneos no
    // pueden darse vuelta dos veces.
    const deseado = typeof activo === 'boolean' ? activo : !club.active;
    if (deseado !== club.active) {
      const actualizado = await Club.findOneAndUpdate(
        { _id: club._id, active: club.active },
        { $set: { active: deseado, suspendidoAt: deseado ? null : new Date() } },
        { new: true },
      );
      if (actualizado) {
        club.active = actualizado.active;
        club.suspendidoAt = actualizado.suspendidoAt;
        // appcarc-backend#169: sin esto, el cache de 5 minutos de esClubActivo
        // dejaría a los usuarios del club entrando/operando con normalidad hasta
        // que expire, aunque el toggle ya se haya guardado.
        invalidarClubActivo(club.slug);
      } else {
        const actual = await Club.findById(club._id);
        return res.status(200).json({ active: actual.active, suspendidoAt: actual.suspendidoAt });
      }
    }

    res.status(200).json({ active: club.active, suspendidoAt: club.suspendidoAt });
  } catch (error) {
    console.error('Error suspendiendo club:', error);
    res.status(500).json({ message: 'Error al suspender/reactivar club' });
  }
};
