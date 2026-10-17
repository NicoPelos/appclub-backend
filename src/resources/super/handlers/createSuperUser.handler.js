import bcrypt from 'bcryptjs';
import User from '../../usuarios/models/User.js';
import { obtenerRolIdsPorNombres } from '../../roles/services/resolverRoles.service.js';
import Club from '../../clubs/models/Club.js';
import { generarPasswordTemporal } from '../../../services/generarPasswordTemporal.service.js';

export const createSuperUserHandler = async (req, res) => {
  try {
    const { email, nombre, clubId, roles = ['admin'], tempPassword } = req.body;

    const esTexto = (v) => typeof v === 'string' && v.trim().length > 0;
    if (!esTexto(email) || !esTexto(clubId)) {
      return res.status(400).json({ message: 'email y clubId son requeridos' });
    }
    if (!Array.isArray(roles) || !roles.every(esTexto)) {
      return res.status(400).json({ message: 'roles debe ser una lista de nombres' });
    }
    if (nombre !== undefined && typeof nombre !== 'string') {
      return res.status(400).json({ message: 'nombre debe ser texto' });
    }
    // Un clubId que no existe creaba un usuario huérfano que nadie puede usar
    // (appcarc-backend#240).
    if (!(await Club.exists({ slug: clubId }))) {
      return res.status(400).json({ message: `No existe un club con clubId '${clubId}'` });
    }

    const existe = await User.findOne({ email, clubId });
    if (existe) return res.status(409).json({ message: 'Ya existe un usuario con ese email en el club' });

    const rolesIds = await obtenerRolIdsPorNombres({ clubId, nombres: roles });
    if (!rolesIds.length) {
      return res.status(400).json({ message: `Ninguno de los roles indicados (${roles.join(', ')}) existe en ese club` });
    }

    const rawPassword = tempPassword || generarPasswordTemporal();
    const salt = await bcrypt.genSalt(10);
    const password = await bcrypt.hash(rawPassword, salt);

    const user = await User.create({
      email, nombre, clubId, roles: rolesIds, password, mustChangePassword: true,
    });

    res.status(201).json({
      user: { id: user._id, email: user.email, nombre: user.nombre, roles, clubId: user.clubId },
      tempPassword: rawPassword,
    });
  } catch (error) {
    console.error('Error creando usuario:', error);
    res.status(500).json({ message: 'Error al crear usuario' });
  }
};
