import Socio from '../models/Socio.js';
import User from '../../usuarios/models/User.js';
import { syncSocioToSheet } from '../services/socioSheetSync.js';

/**
 * @openapi
 * /api/socios/me/profile:
 *   put:
 *     summary: Actualizar el perfil del usuario actual
 *     tags: [Perfil]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nombre:
 *                 type: string
 *                 description: Nombre del usuario
 *               apellido:
 *                 type: string
 *               telefono:
 *                 type: string
 *               correoElectronico:
 *                 type: string
 *               fotoPerfil:
 *                 type: string
 *                 description: URL de la foto de perfil
 *               redesSociales:
 *                 type: object
 *                 properties:
 *                   instagram:
 *                     type: string
 *                   facebook:
 *                     type: string
 *                   twitter:
 *                     type: string
 *                   linkedin:
 *                     type: string
 *                   whatsapp:
 *                     type: string
 *     responses:
 *       200:
 *         description: Perfil actualizado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 socio:
 *                   type: object
 *                 emailChanged:
 *                   type: boolean
 *                   description: true si correoElectronico cambió y por lo tanto también el email de login (User.email) — el cliente debería cerrar la sesión y pedir volver a loguearse.
 *       400:
 *         description: Usuario no tiene socio vinculado
 *       404:
 *         description: Usuario o socio no encontrado
 *       409:
 *         description: Ya existe un usuario con ese email en este club
 *       500:
 *         description: Error al actualizar perfil
 */
export const updateMyProfileHandler = async (req, res) => {
  try {
    const user = await User.findById(req.user?.id);
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    // req.user.socioId es el perfil ACTIVO de la sesión (el propio o un hijo
    // vinculado — ver VinculoFamiliar / issue #28), no necesariamente user.socioId.
    const socioIdActivo = req.user?.socioId;
    if (!socioIdActivo) {
      return res.status(400).json({ message: 'Usuario no tiene socio vinculado' });
    }
    const esPerfilPropio = String(user.socioId) === String(socioIdActivo);

    // Campos permitidos para actualizar (seguridad - no permitir cambiar dni, estado, etc)
    const allowedFields = [
      'nombre',
      'apellido',
      'telefono',
      'correoElectronico',
      'fotoPerfil',
      'redesSociales',
    ];

    const updateData = {};
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    });

    const socioAntes = await Socio.findOne({ _id: socioIdActivo, clubId: req.user?.clubId });
    if (!socioAntes) {
      return res.status(404).json({ message: 'Socio no encontrado' });
    }

    // Si cambia el email de contacto, sincronizarlo también como email de login
    // (User.email) — antes quedaban desincronizados y el usuario seguía teniendo
    // que loguearse con el email viejo. Solo aplica al perfil propio: si el
    // usuario está editando un hijo vinculado, ese cambio es solo del contacto
    // del hijo, no toca las credenciales de quien está logueado.
    const nuevoEmail = updateData.correoElectronico;
    const emailChanged = esPerfilPropio && nuevoEmail !== undefined && nuevoEmail !== socioAntes.correoElectronico;

    if (emailChanged) {
      const existe = await User.findOne({ email: nuevoEmail, clubId: user.clubId, _id: { $ne: user._id } });
      if (existe) {
        return res.status(409).json({ message: 'Ya existe un usuario con ese email en este club' });
      }
    }

    const socio = await Socio.findOneAndUpdate(
      { _id: socioIdActivo, clubId: req.user?.clubId },
      updateData,
      { returnDocument: 'after', runValidators: true }
    );

    if (!socio) {
      return res.status(404).json({ message: 'Socio no encontrado' });
    }

    if (esPerfilPropio) {
      if (updateData.nombre) user.nombre = updateData.nombre;
      if (emailChanged) user.email = nuevoEmail;
      if (updateData.nombre || emailChanged) await user.save();
    }

    // Sincronizar con Google Sheets
    await syncSocioToSheet(socio).catch((err) => console.error('Error sincronizando socio a Google Sheets:', err.message));

    res.status(200).json({
      message: 'Perfil actualizado exitosamente',
      socio,
      emailChanged,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'Ya existe un usuario con ese email en este club' });
    }
    console.error('Error actualizando perfil:', error);
    res.status(500).json({ message: 'Error al actualizar perfil' });
  }
};

export default updateMyProfileHandler;
