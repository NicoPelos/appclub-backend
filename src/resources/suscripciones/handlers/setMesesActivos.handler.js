import mongoose from 'mongoose';
import Suscripcion from '../models/Suscripcion.js';
import Cuota from '../../cuotas/models/Cuota.js';
import Socio from '../../socios/models/Socio.js';
import Etiqueta from '../../etiquetas/models/Etiqueta.js';
import Plan from '../../planes/models/Plan.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { sincronizarEscuelitaPorSuscripcionModificada } from '../../escuelita/services/sincronizarSuscripcionPlan.service.js';
import { PERIODO_PATTERN } from '../../../services/periodos.js';
import { getActor } from '../../../services/getActor.js';


const cubrePeriodo = (tramos, periodo) =>
  tramos.some((t) => t.fechaDesde <= periodo && (t.fechaHasta === null || periodo <= t.fechaHasta));

/**
 * @openapi
 * /api/suscripciones/socio/{socioId}/etiqueta/{etiquetaId}/meses:
 *   put:
 *     summary: Reemplazar de una sola vez todos los tramos activos de una suscripción (grilla año×mes editable desde la app)
 *     tags: [Suscripciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: socioId
 *         in: path
 *         required: true
 *         schema: { type: string }
 *       - name: etiquetaId
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tramos]
 *             properties:
 *               tramos:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [fechaDesde]
 *                   properties:
 *                     fechaDesde: { type: string, example: "2026-04" }
 *                     fechaHasta: { type: string, nullable: true, example: null }
 *                     planId:
 *                       type: string
 *                       nullable: true
 *                       description: Plan de este tramo específico. Si se omite, hereda el plan vigente del tramo de referencia (comportamiento previo) — permite reasignar retroactivamente solo algunos meses a otro plan (ej. Staff/exento) sin tocar el resto.
 *     responses:
 *       200:
 *         description: Tramos actualizados
 *       400:
 *         description: Datos inválidos, tramos superpuestos, o algún planId no existe/no pertenece a esta etiqueta
 *       404:
 *         description: Socio o etiqueta no encontrada
 *       409:
 *         description: Algún período ya pagado quedaría sin cobertura
 *       500:
 *         description: Error al actualizar los meses de la suscripción
 */
export const setMesesActivosHandler = async (req, res) => {
  const { socioId, etiquetaId } = req.params;
  const { tramos } = req.body;
  const actor = getActor(req);

  if (!Array.isArray(tramos)) {
    return res.status(400).json({ message: 'tramos debe ser un array' });
  }
  for (const t of tramos) {
    if (!t || !PERIODO_PATTERN.test(t.fechaDesde)) {
      return res.status(400).json({ message: 'Cada tramo requiere fechaDesde con formato YYYY-MM' });
    }
    if (t.fechaHasta !== undefined && t.fechaHasta !== null && !PERIODO_PATTERN.test(t.fechaHasta)) {
      return res.status(400).json({ message: 'fechaHasta debe tener formato YYYY-MM o null' });
    }
    if (t.fechaHasta && t.fechaHasta < t.fechaDesde) {
      return res.status(400).json({ message: 'fechaHasta no puede ser anterior a fechaDesde' });
    }
  }

  const nuevosTramos = tramos
    .map((t) => ({ fechaDesde: t.fechaDesde, fechaHasta: t.fechaHasta ?? null, planId: t.planId || null }))
    .sort((a, b) => a.fechaDesde.localeCompare(b.fechaDesde));

  for (let i = 1; i < nuevosTramos.length; i++) {
    const prev = nuevosTramos[i - 1];
    const cur = nuevosTramos[i];
    if (prev.fechaHasta === null || cur.fechaDesde <= prev.fechaHasta) {
      return res.status(400).json({ message: 'Los tramos no pueden superponerse' });
    }
  }

  const session = await mongoose.startSession();
  try {
    const socio = await Socio.findOne({ _id: socioId, clubId: req.user.clubId, active: true });
    if (!socio) {
      return res.status(404).json({ message: 'Socio no encontrado' });
    }
    const etiqueta = await Etiqueta.findOne({ _id: etiquetaId, clubId: req.user.clubId, active: true });
    if (!etiqueta) {
      return res.status(404).json({ message: 'Etiqueta no encontrada' });
    }

    let status = 200;
    let errorMessage = null;
    let result = null;

    await session.withTransaction(async () => {
      const existentes = await Suscripcion.find({
        clubId: req.user.clubId, socioId, etiquetaId, active: true,
      }).session(session);

      // Solo protege períodos pagados que HOY están cubiertos por alguno de
      // los tramos activos (el rango que la grilla realmente muestra y deja
      // editar) — historial de tramos viejos ya cerrados/reemplazados queda
      // fuera de este chequeo, igual que hacía excluir-periodo.
      const cuotasPagadas = await Cuota.find({
        clubId: req.user.clubId, socioId, etiquetaId, estado: 'pagada', active: true,
      }).select('periodo').session(session);
      const periodoNoCubierto = cuotasPagadas
        .filter((c) => cubrePeriodo(existentes, c.periodo))
        .find((c) => !cubrePeriodo(nuevosTramos, c.periodo));
      if (periodoNoCubierto) {
        status = 409;
        errorMessage = `El período ${periodoNoCubierto.periodo} ya está pagado y tiene que seguir cubierto por algún tramo`;
        return;
      }

      const referencia = existentes[0] ?? null;

      // Cada tramo puede pedir explícitamente un plan propio (para reasignar
      // retroactivamente solo algunos meses a otro plan, ej. Staff/exento,
      // sin tocar el resto) — si no lo pide, hereda el plan vigente del
      // tramo de referencia, igual que antes de poder elegir por tramo.
      for (const t of nuevosTramos) {
        if (!t.planId && referencia?.planId) t.planId = String(referencia.planId);
      }

      const planIdsDistintos = [...new Set(nuevosTramos.map((t) => t.planId).filter(Boolean))];
      let exentoPorPlan = new Map();
      if (planIdsDistintos.length) {
        const planesValidos = await Plan.find({
          _id: { $in: planIdsDistintos }, clubId: req.user.clubId, etiquetaId, active: true,
        }).session(session).lean();
        if (planesValidos.length !== planIdsDistintos.length) {
          const encontrados = new Set(planesValidos.map((p) => String(p._id)));
          const faltante = planIdsDistintos.find((id) => !encontrados.has(id));
          status = 400;
          errorMessage = `El plan ${faltante} no existe, no pertenece a esta etiqueta, o está inactivo`;
          return;
        }
        exentoPorPlan = new Map(planesValidos.map((p) => [String(p._id), Boolean(p.noGeneraDeuda)]));
      }

      const usadas = new Set();

      for (const s of existentes) {
        const match = nuevosTramos.find((t) => t.fechaDesde === s.fechaDesde);
        if (match && s.fechaHasta === match.fechaHasta && String(s.planId ?? '') === String(match.planId ?? '')) {
          usadas.add(match.fechaDesde);
          continue;
        }
        const before = s.toObject();
        s.active = false;
        s.updatedBy = actor;
        await s.save({ session });
        logAudit({ clubId: req.user?.clubId, req, action: 'UPDATE', resource: 'Suscripcion', resourceId: s._id, before, after: s.toObject() });
      }

      const finales = [];
      for (const t of nuevosTramos) {
        if (usadas.has(t.fechaDesde)) {
          finales.push(existentes.find((s) => s.fechaDesde === t.fechaDesde));
          continue;
        }

        const exento = t.planId ? (exentoPorPlan.get(t.planId) ?? false) : false;

        // Puede existir un documento soft-deleted con el mismo fechaDesde (el
        // índice único no libera el slot con active:false) — reactivarlo en
        // vez de chocar al crear uno nuevo.
        const existenteInactivo = await Suscripcion.findOne({
          clubId: req.user.clubId, socioId, etiquetaId, fechaDesde: t.fechaDesde,
        }).session(session);

        if (existenteInactivo) {
          const before = existenteInactivo.toObject();
          existenteInactivo.active = true;
          existenteInactivo.fechaHasta = t.fechaHasta;
          existenteInactivo.planId = t.planId;
          existenteInactivo.exento = exento;
          existenteInactivo.updatedBy = actor;
          await existenteInactivo.save({ session });
          logAudit({ clubId: req.user?.clubId, req, action: 'UPDATE', resource: 'Suscripcion', resourceId: existenteInactivo._id, before, after: existenteInactivo.toObject() });
          finales.push(existenteInactivo);
        } else {
          const nueva = new Suscripcion({
            clubId: req.user.clubId,
            socioId,
            etiquetaId,
            planId: t.planId,
            exento,
            fechaDesde: t.fechaDesde,
            fechaHasta: t.fechaHasta,
            createdBy: actor,
            updatedBy: actor,
          });
          await nueva.save({ session });
          logAudit({ clubId: req.user?.clubId, req, action: 'CREATE', resource: 'Suscripcion', resourceId: nueva._id, before: null, after: nueva.toObject() });
          finales.push(nueva);
        }
      }

      await sincronizarEscuelitaPorSuscripcionModificada({
        clubId: req.user.clubId, socioId, etiquetaId, req, session,
      });
      result = { suscripciones: finales };
    });

    if (errorMessage) {
      return res.status(status).json({ message: errorMessage });
    }
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error actualizando meses de suscripción:', error);
    return res.status(500).json({ message: 'Error al actualizar los meses de la suscripción' });
  } finally {
    session.endSession();
  }
};

