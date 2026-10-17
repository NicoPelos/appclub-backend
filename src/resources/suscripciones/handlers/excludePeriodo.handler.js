import mongoose from 'mongoose';
import Suscripcion from '../models/Suscripcion.js';
import Cuota from '../../cuotas/models/Cuota.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { sincronizarEscuelitaPorSuscripcionModificada } from '../../escuelita/services/sincronizarSuscripcionPlan.service.js';
import { PERIODO_PATTERN, periodoAnterior } from '../../../services/periodos.js';
import { getActor } from '../../../services/getActor.js';


const periodoSiguiente = (periodo) => {
  const [year, month] = periodo.split('-').map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
};

/**
 * @openapi
 * /api/suscripciones/{id}/excluir-periodo:
 *   put:
 *     summary: Excluir un período puntual de una suscripción (ej. no asistió ese mes) sin darla de baja entera
 *     tags: [Suscripciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [periodo]
 *             properties:
 *               periodo:
 *                 type: string
 *                 example: "2026-07"
 *                 description: Período a excluir, formato YYYY-MM
 *     responses:
 *       200:
 *         description: Período excluido
 *       400:
 *         description: Datos inválidos o período fuera de rango
 *       404:
 *         description: Suscripción no encontrada
 *       409:
 *         description: El período ya está pagado
 *       500:
 *         description: Error al excluir el período
 */
export const excludePeriodoHandler = async (req, res) => {
  const { id } = req.params;
  const { periodo } = req.body;
  const actor = getActor(req);

  if (!periodo || !PERIODO_PATTERN.test(periodo)) {
    return res.status(400).json({ message: 'periodo debe tener formato YYYY-MM' });
  }

  const session = await mongoose.startSession();
  try {
    let result = null;
    let status = 200;
    let errorMessage = null;

    await session.withTransaction(async () => {
      const suscripcion = await Suscripcion.findOne({ _id: id, clubId: req.user.clubId, active: true }).session(session);
      if (!suscripcion) { status = 404; errorMessage = 'Suscripción no encontrada'; return; }

      if (periodo < suscripcion.fechaDesde) {
        status = 400; errorMessage = 'El período es anterior al inicio de la suscripción'; return;
      }
      if (suscripcion.fechaHasta && periodo > suscripcion.fechaHasta) {
        status = 400; errorMessage = 'El período es posterior al fin de la suscripción'; return;
      }

      const cuotaPagada = await Cuota.findOne({
        clubId: req.user.clubId, suscripcionId: suscripcion._id, periodo, estado: 'pagada', active: true,
      }).session(session);
      if (cuotaPagada) {
        status = 409; errorMessage = 'Ese período ya está pagado, no se puede excluir'; return;
      }

      const suscripcionAntes = suscripcion.toObject();
      const fechaHastaOriginal = suscripcion.fechaHasta;

      if (periodo === suscripcion.fechaDesde) {
        const nuevoDesde = periodoSiguiente(periodo);
        if (fechaHastaOriginal && nuevoDesde > fechaHastaOriginal) {
          suscripcion.active = false;
        } else {
          suscripcion.fechaDesde = nuevoDesde;
        }
        suscripcion.updatedBy = actor;
        await suscripcion.save({ session });
        logAudit({ clubId: req.user?.clubId, req, action: 'UPDATE', resource: 'Suscripcion', resourceId: suscripcion._id, before: suscripcionAntes, after: suscripcion.toObject() });
        await sincronizarEscuelitaPorSuscripcionModificada({
          clubId: req.user.clubId, socioId: suscripcion.socioId, etiquetaId: suscripcion.etiquetaId, req, session,
        });
        result = { suscripciones: [suscripcion] };
        return;
      }

      if (fechaHastaOriginal && periodo === fechaHastaOriginal) {
        suscripcion.fechaHasta = periodoAnterior(periodo);
        suscripcion.updatedBy = actor;
        await suscripcion.save({ session });
        logAudit({ clubId: req.user?.clubId, req, action: 'UPDATE', resource: 'Suscripcion', resourceId: suscripcion._id, before: suscripcionAntes, after: suscripcion.toObject() });
        await sincronizarEscuelitaPorSuscripcionModificada({
          clubId: req.user.clubId, socioId: suscripcion.socioId, etiquetaId: suscripcion.etiquetaId, req, session,
        });
        result = { suscripciones: [suscripcion] };
        return;
      }

      suscripcion.fechaHasta = periodoAnterior(periodo);
      suscripcion.updatedBy = actor;
      await suscripcion.save({ session });
      logAudit({ clubId: req.user?.clubId, req, action: 'UPDATE', resource: 'Suscripcion', resourceId: suscripcion._id, before: suscripcionAntes, after: suscripcion.toObject() });

      const nuevoDesde = periodoSiguiente(periodo);
      const existente = await Suscripcion.findOne({
        clubId: req.user.clubId, socioId: suscripcion.socioId, etiquetaId: suscripcion.etiquetaId, fechaDesde: nuevoDesde,
      }).session(session);

      let nueva;
      if (existente) {
        const existenteAntes = existente.toObject();
        existente.active = true;
        existente.planId = suscripcion.planId;
        existente.fechaHasta = fechaHastaOriginal;
        existente.exento = suscripcion.exento;
        existente.updatedBy = actor;
        await existente.save({ session });
        logAudit({ clubId: req.user?.clubId, req, action: 'UPDATE', resource: 'Suscripcion', resourceId: existente._id, before: existenteAntes, after: existente.toObject() });
        nueva = existente;
      } else {
        nueva = new Suscripcion({
          clubId: req.user.clubId,
          socioId: suscripcion.socioId,
          planId: suscripcion.planId,
          etiquetaId: suscripcion.etiquetaId,
          fechaDesde: nuevoDesde,
          fechaHasta: fechaHastaOriginal,
          exento: suscripcion.exento,
          createdBy: actor,
          updatedBy: actor,
        });
        await nueva.save({ session });
        logAudit({ clubId: req.user?.clubId, req, action: 'CREATE', resource: 'Suscripcion', resourceId: nueva._id, before: null, after: nueva.toObject() });
      }

      await sincronizarEscuelitaPorSuscripcionModificada({
        clubId: req.user.clubId, socioId: suscripcion.socioId, etiquetaId: suscripcion.etiquetaId, req, session,
      });
      result = { suscripciones: [suscripcion, nueva] };
    });

    if (errorMessage) {
      return res.status(status).json({ message: errorMessage });
    }
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error excluyendo período de suscripción:', error);
    return res.status(500).json({ message: 'Error al excluir el período' });
  } finally {
    session.endSession();
  }
};

