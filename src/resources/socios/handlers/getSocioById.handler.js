import Socio from '../models/Socio.js';
import User from '../../usuarios/models/User.js';


/**
 * @openapi
 * /api/socios/{id}:
 *   get:
 *     summary: Obtener socio por ID
 *     tags: [Socios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         description: ID del socio
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Socio encontrado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Socio'
 *       404:
 *         description: Socio no encontrado
 *       500:
 *         description: Error al obtener socio
 */ 

export const getSocioByIdHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const isSocioOnly = req.user?.roles?.length > 0 && req.user.roles.every(r => r === 'socio');
    if (isSocioOnly && req.user.socioId !== id) {
      return res.status(403).json({ message: 'No tenés permiso para ver el perfil de otro socio' });
    }
    const socio = await Socio.findOne({ _id: id, clubId: req.user?.clubId }).lean();
    if (!socio) return res.status(404).json({ message: 'Socio no encontrado' });

    // Para poder consultar "¿este socio es tutor de otros?" (GET /api/vinculos
    // ?padreUserId=), hace falta el _id de su User, no del Socio — son
    // colecciones distintas. Null si el socio no tiene cuenta asociada (ej.
    // un menor sin email propio).
    const user = await User.findOne({ socioId: id, clubId: req.user?.clubId });

    res.status(200).json({ ...socio, userId: user?._id ?? null });
  } catch (error) {
    console.error('Error obteniendo socio (handler):', error);
    res.status(500).json({ message: 'Error al obtener socio' });
  }
};

export default getSocioByIdHandler;
