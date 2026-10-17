import Socio from '../models/Socio.js';
import { syncSocioToSheet } from '../services/socioSheetSync.js';
import { prepareSocioUpdateData, syncSocioUserIfPossible } from '../services/socioData.service.js';
import { cerrarSuscripcionesPorBaja } from '../services/cerrarSuscripcionesPorBaja.service.js';
import { sendPushNotification } from '../../../services/pushNotification.service.js';
import User from '../../usuarios/models/User.js';
import { logAudit } from '../../audit/services/audit.service.js';

const ESTADO_LABEL = { Activo: 'Activo', Adherente: 'Adherente', Baja: 'Baja' };

const buildNotificationMessage = (changes) => {
  const lines = [];
  if (changes.estado) lines.push(`Tu estado de socio cambió a: ${ESTADO_LABEL[changes.estado] ?? changes.estado}`);
  if (changes.correoElectronico) lines.push('Tu correo electrónico fue actualizado');
  if (changes.telefono) lines.push('Tu teléfono fue actualizado');
  if (changes.domicilioCompleto) lines.push('Tu domicilio fue actualizado');
  return lines.join(' · ');
};

/**
 * @openapi
 * /api/socios/{id}:
 *   put:
 *     summary: Actualizar socio
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               dni:
 *                 type: string
 *                 description: DNI del socio
 *               nombre:
 *                 type: string
 *                 description: Nombre del socio
 *               apellido:
 *                 type: string
 *                 description: Apellido del socio
 *               correoElectronico:
 *                 type: string
 *                 description: Correo electrónico del socio
 *               telefono:
 *                 type: string
 *                 description: Teléfono del socio
 *               domicilioCompleto:
 *                 type: string
 *                 description: Domicilio completo del socio
 *               calle:
 *                 type: string
 *                 description: Calle del socio
 *               altura:
 *                 type: string
 *                 description: Altura del socio
 *               direccionActual:
 *                 type: string
 *                 description: Dirección actual del socio
 *     responses:
*       200:
*         description: Socio actualizado exitosamente
*       400:
*         description: Error en los datos enviados para la actualización
*       404:
*         description: Socio no encontrado
*       500:
*         description: Error al actualizar socio
 */


const NOTIFIABLE_FIELDS = ['estado', 'correoElectronico', 'telefono', 'domicilioCompleto'];

export const updateSocioHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = prepareSocioUpdateData(req.body, req.user);

    const socioAntes = await Socio.findOne({ _id: id, clubId: req.user?.clubId });
    if (!socioAntes) return res.status(404).json({ message: 'Socio no encontrado' });

    const socio = await Socio.findOneAndUpdate(
      { _id: id, clubId: req.user?.clubId },
      updateData,
      { returnDocument: 'after', runValidators: true }
    );

    syncSocioToSheet(socio).catch((err) => console.error('Error actualizando Google Sheets:', err.message));
    syncSocioUserIfPossible(socio).catch(() => {});

    if (updateData.estado === 'Baja' && socioAntes.estado !== 'Baja') {
      await cerrarSuscripcionesPorBaja({ clubId: req.user?.clubId, socioId: socio._id, req });
    }

    const changes = {};
    for (const field of NOTIFIABLE_FIELDS) {
      if (updateData[field] !== undefined && updateData[field] !== socioAntes[field]) {
        changes[field] = updateData[field];
      }
    }

    if (Object.keys(changes).length > 0) {
      const user = await User.findOne({ socioId: socioAntes._id.toString(), active: true })
        .select('expoPushToken clubId').lean();
      if (user) {
        const body = buildNotificationMessage(changes);
        sendPushNotification([{ userId: user._id, clubId: user.clubId, token: user.expoPushToken }], {
          title: 'Actualización de tu ficha de socio',
          body,
          data: { tipo: 'socio_update', socioId: id, url: 'carc://mis-datos' },
        }).catch((err) => console.error('Error enviando push de socio update:', err));
      }
    }

    logAudit({ clubId: req.user?.clubId, req, action: 'UPDATE', resource: 'Socio', resourceId: socio._id, before: socioAntes.toObject(), after: socio.toObject() });

    res.status(200).json(socio);
  } catch (error) {
    console.error('Error actualizando socio (handler):', error);
    res.status(400).json({ message: error.message });
  }
};

export default updateSocioHandler;
