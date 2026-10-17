import express from 'express';
import mongoose from 'mongoose';
import { createSocioHandler } from './handlers/createSocio.handler.js';
import { getSociosHandler } from './handlers/getSocios.handler.js';
import { getSocioByIdHandler } from './handlers/getSocioById.handler.js';
import { updateSocioHandler } from './handlers/updateSocio.handler.js';
import { deleteSocioHandler } from './handlers/deleteSocio.handler.js';
import { restoreSocioHandler } from './handlers/restoreSocio.handler.js';
import { getSocioQrHandler } from './handlers/getSocioQr.handler.js';
import { verifySocioQrHandler } from './handlers/verifySocioQr.handler.js';
import { getMyProfileHandler } from './handlers/getMyProfile.handler.js';
import { updateMyProfileHandler } from './handlers/updateMyProfile.handler.js';
import { getSocioDeudaHandler } from './handlers/getSocioDeuda.handler.js';
import { getSociosMorososHandler } from './handlers/getSociosMorosos.handler.js';
import { upload, uploadFotoSocioHandler, handleUploadError } from './handlers/uploadFotoSocio.handler.js';
import { deleteFotoSocioHandler } from './handlers/deleteFotoSocio.handler.js';
import { protect, authorize, authorizeSelfSocioOr } from '../../middleware/auth.js';
import { getPasesSemanaSocioHandler } from './handlers/getPasesSemanaSocio.handler.js';
import { PERMISOS } from '../../constants/permisos.js';

const router = express.Router();

// Un id que no es ObjectId terminaba en 500 por CastError (appcarc-backend#234).
router.param('id', (req, res, next, id) => (
  mongoose.isValidObjectId(id) ? next() : res.status(400).json({ message: 'ID inválido' })
));

/**
 * @openapi
 * /api/socios:
 *   get:
 *     summary: Obtener lista de socios
 *     tags: [Socios]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de socios disponible
 */
router.get('/', protect, authorize(PERMISOS.SOCIOS_READ), getSociosHandler);

/**
 * @openapi
 * /api/socios:
 *   post:
 *     summary: Crear un nuevo socio
 *     tags: [Socios]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               socioNumber:
 *                 type: string
 *               sexo:
 *                 type: string
 *                 enum: [Masculino, Femenino, Otro]
 *               apellido:
 *                 type: string
 *               nombre:
 *                 type: string
 *               dni:
 *                 type: string
 *               fechaNacimiento:
 *                 type: string
 *                 format: date
 *               direccionActual:
 *                 type: string
 *               domicilioCompleto:
 *                 type: string
 *               calle:
 *                 type: string
 *               altura:
 *                 type: string
 *               ciudad:
 *                 type: string
 *               nacionalidad:
 *                 type: string
 *               telefonoEmergencia:
 *                 type: string
 *               observaciones:
 *                 type: string
 *               fechaDeAsociado:
 *                 type: string
 *                 format: date
 *               estado:
 *                 type: string
 *                 enum: [Activo, Adherente, Baja]
 *               condicionObs:
 *                 type: string
 *               correoElectronico:
 *                 type: string
 *                 format: email
 *               telefono:
 *                 type: string
 *     responses:
 *       201:
 *         description: Socio creado exitosamente
 */
router.post('/', protect, authorize(PERMISOS.SOCIOS_CREATE), createSocioHandler);

// Rutas de perfil personal
router.get('/me/profile', protect, getMyProfileHandler);
router.put('/me/profile', protect, updateMyProfileHandler);

router.get('/:id/deuda', protect, getSocioDeudaHandler);
router.put('/:id/foto', protect, authorizeSelfSocioOr(PERMISOS.SOCIOS_WRITE), upload.single('foto'), handleUploadError, uploadFotoSocioHandler);
router.delete('/:id/foto', protect, authorizeSelfSocioOr(PERMISOS.SOCIOS_WRITE), deleteFotoSocioHandler);

router.get('/:id/qr', protect, authorizeSelfSocioOr(PERMISOS.SOCIOS_READ), getSocioQrHandler);
router.get('/:id/pases-semana', protect, authorizeSelfSocioOr(PERMISOS.SOCIOS_READ), getPasesSemanaSocioHandler);
router.post('/verify', protect, authorize(PERMISOS.SOCIOS_READ), verifySocioQrHandler);

router.get('/morosos', protect, authorize(PERMISOS.COBROS_READ), getSociosMorososHandler);

router.get('/:id', protect, authorizeSelfSocioOr(PERMISOS.SOCIOS_READ), getSocioByIdHandler);

/**
 * @openapi
 * /api/socios/{id}:
 *   put:
 *     summary: Actualizar datos de un socio
 *     tags: [Socios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               apellido:
 *                 type: string
 *               nombre:
 *                 type: string
 *               sexo:
 *                 type: string
 *               direccionActual:
 *                 type: string
 *               ciudad:
 *                 type: string
 *               nacionalidad:
 *                 type: string
 *               fechaDeAsociado:
 *                 type: string
 *                 format: date
 *               estado:
 *                 type: string
 *               condicionObs:
 *                 type: string
 *               correoElectronico:
 *                 type: string
 *                 format: email
 *               telefono:
 *                 type: string
 *     responses:
 *       200:
 *         description: Socio actualizado exitosamente
 */
router.put('/:id', protect, authorize(PERMISOS.SOCIOS_WRITE), updateSocioHandler);
router.put('/:id/restore', protect, authorize(PERMISOS.SOCIOS_RESTORE), restoreSocioHandler);

/**
 * @openapi
 * /api/socios/{id}/restore:
 *   put:
 *     summary: Restaurar socio desde la papelera
 *     tags: [Socios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Socio restaurado exitosamente
 */

/**
 * @openapi
 * /api/socios/{id}:
 *   delete:
 *     summary: Desactivar un socio
 *     tags: [Socios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Socio desactivado con éxito
 */
router.delete('/:id', protect, authorize(PERMISOS.SOCIOS_DELETE), deleteSocioHandler);

export default router;
