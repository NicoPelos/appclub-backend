import mongoose from 'mongoose';
import { crearVinculoFamiliar } from '../services/crearVinculoFamiliar.service.js';
import { BusinessError } from '../services/businessError.js';
import { logAudit } from '../../audit/services/audit.service.js';

/**
 * @openapi
 * /api/vinculos:
 *   post:
 *     summary: Vincular un socio (hijo) a un usuario tutor (padre/madre), que podrá "entrar como" ese socio
 *     tags: [Vinculos]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [hijoSocioId]
 *             properties:
 *               hijoSocioId:
 *                 type: string
 *               padreUserId:
 *                 type: string
 *                 description: Usuario tutor ya existente
 *               padreSocioId:
 *                 type: string
 *                 description: El tutor es socio del club — se usa/crea su cuenta
 *               padreEmail:
 *                 type: string
 *                 description: El tutor no es socio — se busca o crea una cuenta con este email
 *               padreNombre:
 *                 type: string
 *                 description: Requerido junto con padreEmail si la cuenta del tutor todavía no existe
 *     responses:
 *       201:
 *         description: Vínculo creado. Si se creó una cuenta de tutor nueva, la respuesta incluye passwordTemporal — comunicársela al tutor, no hay otro canal.
 *       400:
 *         description: Datos inválidos
 *       404:
 *         description: Socio o usuario no encontrado
 *       409:
 *         description: El vínculo ya existe
 */
export const crearVinculoHandler = async (req, res) => {
  try {
    const { hijoSocioId, padreUserId, padreSocioId } = req.body;
    if (!hijoSocioId) return res.status(400).json({ message: 'hijoSocioId es requerido' });
    // Un id con formato inválido dispara un CastError async en la query de
    // resolverPadre (crearVinculoFamiliar.service.js), sin capturar ahí ->
    // 500 genérico en vez de 400 (appcarc-backend#212).
    if (!mongoose.isValidObjectId(hijoSocioId)) return res.status(400).json({ message: 'hijoSocioId inválido' });
    if (padreUserId && !mongoose.isValidObjectId(padreUserId)) return res.status(400).json({ message: 'padreUserId inválido' });
    if (padreSocioId && !mongoose.isValidObjectId(padreSocioId)) return res.status(400).json({ message: 'padreSocioId inválido' });

    const { vinculo, padre, passwordTemporal } = await crearVinculoFamiliar({
      clubId: req.user?.clubId,
      user: req.user,
      hijoSocioId,
      body: req.body,
    });

    logAudit({ clubId: req.user?.clubId, req, action: 'CREATE', resource: 'VinculoFamiliar', resourceId: vinculo._id, before: null, after: vinculo.toObject() });
    return res.status(201).json({
      vinculo,
      padre: { id: padre._id, email: padre.email, nombre: padre.nombre },
      // Solo viene si se creó una cuenta nueva en este llamado — hay que
      // comunicársela al tutor a mano, no existe otro canal (no es socio,
      // sin DNI conocido, sin email de bienvenida).
      passwordTemporal: passwordTemporal || null,
    });
  } catch (error) {
    if (error instanceof BusinessError) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error('Error creando vínculo familiar:', error);
    return res.status(500).json({ message: 'Error al crear el vínculo' });
  }
};

export default crearVinculoHandler;
