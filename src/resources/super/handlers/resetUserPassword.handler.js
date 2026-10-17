import bcrypt from 'bcryptjs';
import User from '../../usuarios/models/User.js';
import { generarPasswordTemporal } from '../../../services/generarPasswordTemporal.service.js';

export const resetUserPasswordHandler = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

    const tempPassword = generarPasswordTemporal();
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(tempPassword, salt);
    user.mustChangePassword = true;
    user.passwordChangedAt = new Date();
    await user.save();

    res.status(200).json({ message: 'Contraseña reseteada', tempPassword });
  } catch (error) {
    console.error('Error reseteando contraseña:', error);
    res.status(500).json({ message: 'Error al resetear contraseña' });
  }
};
