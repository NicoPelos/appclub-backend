import Socio from '../models/Socio.js';
import Advertencia from '../../advertencias/models/Advertencia.js';
import { syncSocioToSheet } from '../services/socioSheetSync.js';
import { cerrarSuscripcionesPorBaja } from '../services/cerrarSuscripcionesPorBaja.service.js';
import { logAudit } from '../../audit/services/audit.service.js';
import User from '../../usuarios/models/User.js';
import { anularVinculosFamiliares } from '../../vinculos/services/anularVinculosFamiliares.service.js';
import { getActor } from '../../../services/getActor.js';

/**
 * @openapi
 * /api/socios/{id}:
 *   delete:
 *     summary: Eliminar socio
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
 *         description: Socio eliminado con éxito
 *       404:
 *         description: Socio no encontrado
 *       500:
 *         description: Error al eliminar socio
 */

export const deleteSocioHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const socioAntes = await Socio.findOne({ _id: id, clubId: req.user?.clubId, active: true }).lean();
    if (!socioAntes) return res.status(404).json({ message: 'Socio no encontrado' });

    const socio = await Socio.findOneAndUpdate(
      { _id: id, clubId: req.user?.clubId },
      { active: false, deletedAt: new Date(), deletedBy: req.user?.id, updatedBy: req.user?.id },
      { returnDocument: 'after' }
    );

    // Resolver advertencias abiertas (ej. morosidad) para que el panel deje de
    // mostrar/ofrecer contactar a un socio ya eliminado — si no, quedan
    // visibles hasta el próximo barrido semanal de avisoMorosidad.job.js.
    await Advertencia.updateMany(
      { clubId: req.user?.clubId, socioId: id, estado: 'abierta' },
      { estado: 'resuelta', resueltoEn: new Date() },
    );

    // Mismo efecto que dar de baja por PUT /:id (estado: 'Baja') — si no, la
    // deuda del socio sigue creciendo mientras está en la papelera, y
    // reaparece al restaurarlo (appcarc-backend#131).
    await cerrarSuscripcionesPorBaja({ clubId: req.user?.clubId, socioId: id, req });

    const cuentasDelSocio = await User.find({ clubId: req.user?.clubId, socioId: id }).select('_id').lean();
    await anularVinculosFamiliares({
      clubId: req.user?.clubId,
      hijoSocioIds: [id],
      padreUserIds: cuentasDelSocio.map((u) => u._id),
      actor: getActor(req),
    });

    await syncSocioToSheet(socio, { appendIfMissing: false, deleted: true }).catch((err) => console.error('Error sincronizando baja a Google Sheets:', err.message));

    logAudit({ clubId: req.user?.clubId, req, action: 'DELETE', resource: 'Socio', resourceId: id, before: socioAntes, after: null });

    res.status(200).json({ message: 'Socio desactivado con éxito' });
  } catch (error) {
    console.error('Error eliminando socio (handler):', error);
    res.status(500).json({ message: 'Error al eliminar socio' });
  }
};

export default deleteSocioHandler;
