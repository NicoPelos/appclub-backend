import User from '../../usuarios/models/User.js';
import { anularVinculosFamiliares } from '../../vinculos/services/anularVinculosFamiliares.service.js';
import { obtenerRolIdsPorNombres } from '../../roles/services/resolverRoles.service.js';
import { getActor } from '../../../services/getActor.js';

export const updateSuperUserHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, roles, active } = req.body;

    const existente = await User.findById(id).select('clubId');
    if (!existente) return res.status(404).json({ message: 'Usuario no encontrado' });

    const update = {};
    if (nombre !== undefined) update.nombre = nombre;
    if (active !== undefined) update.active = active;
    if (roles !== undefined) {
      const rolesIds = await obtenerRolIdsPorNombres({ clubId: existente.clubId, nombres: roles });
      if (!rolesIds.length) {
        return res.status(400).json({ message: `Ninguno de los roles indicados (${roles.join(', ')}) existe en ese club` });
      }
      update.roles = rolesIds;
    }

    const user = await User.findByIdAndUpdate(id, { $set: update }, { new: true })
      .select('-password -expoPushToken');

    if (update.active === false) {
      await anularVinculosFamiliares({
        clubId: existente.clubId,
        padreUserIds: [existente._id],
        actor: getActor(req),
      });
    }

    res.status(200).json(user);
  } catch (error) {
    console.error('Error actualizando usuario:', error);
    res.status(500).json({ message: 'Error al actualizar usuario' });
  }
};
