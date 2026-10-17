import mongoose from 'mongoose';
import Suscripcion from '../models/Suscripcion.js';
import Socio from '../../socios/models/Socio.js';
import Etiqueta from '../../etiquetas/models/Etiqueta.js';
import Plan from '../../planes/models/Plan.js';
import Escuelita from '../../escuelita/models/Escuelita.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { PERIODO_PATTERN, periodoAnterior } from '../../../services/periodos.js';
import { getActor } from '../../../services/getActor.js';


// Un socio solo puede tener una suscripción activa por vez para la misma
// etiqueta, o — si se asigna con Plan — para el mismo tipo de plan (social /
// escuelita / muro_libre), aunque sea a otra etiqueta (ej. pasar de
// Escuelita x1 a Escuelita x2). Antes de crear la nueva, cierra cualquier
// otra que siga vigente para que no queden dos activas en simultáneo (pasó
// con varios socios al reasignar un plan sin cerrar el
// anterior). La comparación por etiquetaId es la que de verdad importa —
// evaluarla siempre (no solo cuando no hay Plan) es necesario porque casi
// ninguna suscripción vieja tiene planId seteado (se crearon por script o
// por asignación suelta), así que comparar únicamente por tipo de Plan
// nunca las encontraba y quedaban duplicadas (appcarc-backend#31).
const cerrarSuscripcionesPrevias = async ({ clubId, socioId, tipo, etiquetaId, fechaDesde, req, session }) => {
  const activas = await Suscripcion.find({ clubId, socioId, active: true, fechaHasta: null })
    .populate('planId', 'tipo')
    .session(session);

  const aCerrar = activas.filter((s) => (
    String(s.etiquetaId) === String(etiquetaId) || (tipo && s.planId?.tipo === tipo)
  ));

  for (const s of aCerrar) {
    const before = s.toObject();
    s.fechaHasta = periodoAnterior(fechaDesde);
    s.updatedBy = getActor(req);
    await s.save({ session });
    logAudit({ clubId, req, action: 'UPDATE', resource: 'Suscripcion', resourceId: s._id, before, after: s.toObject() });
  }
};

// "Asignar plan" desde Detalle de socio crea la Suscripcion que cobra, pero
// la lista de alumnos de Escuelita se arma a partir de la ficha Escuelita
// (estado, planId, fechaInscripcion) — sin esto, asignar un plan de escuelita
// ahí dejaba a la persona cobrando sin figurar como alumna (mismo tipo de
// descalce que causó appcarc-backend#51/Catalina Marzari).
const sincronizarFichaEscuelita = async ({ clubId, socioId, socio, planDoc, req, session }) => {
  const actor = getActor(req);
  const existente = await Escuelita.findOne({ clubId, socioId, active: true }).session(session);

  if (existente) {
    if (String(existente.planId ?? '') === String(planDoc._id)) return;
    const before = existente.toObject();
    existente.planId = planDoc._id;
    existente.updatedBy = actor;
    await existente.save({ session });
    logAudit({ clubId, req, action: 'UPDATE', resource: 'Escuelita', resourceId: existente._id, before, after: existente.toObject() });
    return;
  }

  const nuevo = new Escuelita({
    clubId,
    socioId,
    dni: socio.dni || '',
    estado: 'activo',
    planId: planDoc._id,
    createdBy: actor,
    updatedBy: actor,
  });
  await nuevo.save({ session });
  logAudit({ clubId, req, action: 'CREATE', resource: 'Escuelita', resourceId: nuevo._id, before: null, after: nuevo.toObject() });
};

/**
 * @openapi
 * /api/suscripciones:
 *   post:
 *     summary: Crear suscripción (admin o secretaria)
 *     tags: [Suscripciones]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [socioId, fechaDesde]
 *             properties:
 *               socioId:
 *                 type: string
 *               planId:
 *                 type: string
 *                 description: ID del Plan. Si se provee, etiquetaId se resuelve automáticamente del plan.
 *               etiquetaId:
 *                 type: string
 *                 description: ID de la Etiqueta. Requerido si no se provee planId.
 *               fechaDesde:
 *                 type: string
 *                 example: "2026-01"
 *                 description: Período de inicio en formato YYYY-MM
 *               fechaHasta:
 *                 type: string
 *                 example: "2026-12"
 *                 description: Período de fin en formato YYYY-MM (opcional)
 *     responses:
 *       201:
 *         description: Suscripción creada
 *       400:
 *         description: Datos inválidos
 *       404:
 *         description: Socio o etiqueta no encontrada
 *       500:
 *         description: Error al crear suscripción
 */
export const createSuscripcionHandler = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const { socioId, planId, etiquetaId: etiquetaIdBody, fechaDesde, fechaHasta } = req.body;

    if (!socioId) {
      return res.status(400).json({ message: 'socioId es requerido' });
    }
    if (!planId && !etiquetaIdBody) {
      return res.status(400).json({ message: 'planId o etiquetaId es requerido' });
    }
    if (!fechaDesde) {
      return res.status(400).json({ message: 'fechaDesde es requerido' });
    }
    if (!PERIODO_PATTERN.test(fechaDesde)) {
      return res.status(400).json({ message: 'fechaDesde debe tener formato YYYY-MM' });
    }
    if (fechaHasta !== undefined && fechaHasta !== null && !PERIODO_PATTERN.test(fechaHasta)) {
      return res.status(400).json({ message: 'fechaHasta debe tener formato YYYY-MM' });
    }
    // Sin este chequeo, fechaHasta < fechaDesde solo se detectaba recién en
    // el validator de Mongoose al hacer .save() (dentro de la transacción),
    // cayendo al catch genérico -> 500 en vez de 400 (appcarc-backend#206,
    // mismo chequeo explícito que ya hacen closeSuscripcion.handler.js y
    // setMesesActivos.handler.js).
    if (fechaHasta && fechaHasta < fechaDesde) {
      return res.status(400).json({ message: 'fechaHasta no puede ser anterior a fechaDesde' });
    }

    const socio = await Socio.findOne({ _id: socioId, clubId: req.user.clubId, active: true });
    if (!socio) {
      return res.status(404).json({ message: 'Socio no encontrado' });
    }

    let etiquetaId = etiquetaIdBody;
    let planDoc = null;

    if (planId) {
      planDoc = await Plan.findOne({ _id: planId, clubId: req.user.clubId, active: true });
      if (!planDoc) return res.status(404).json({ message: 'Plan no encontrado' });
      etiquetaId = planDoc.etiquetaId;
    } else {
      const etiqueta = await Etiqueta.findOne({ _id: etiquetaId, clubId: req.user.clubId, active: true });
      if (!etiqueta) return res.status(404).json({ message: 'Etiqueta no encontrada' });
    }

    let suscripcion;
    await session.withTransaction(async () => {
      await cerrarSuscripcionesPrevias({
        clubId: req.user.clubId,
        socioId,
        tipo: planDoc?.tipo ?? null,
        etiquetaId,
        fechaDesde,
        req,
        session,
      });

      // Puede existir una Suscripcion inactiva (soft-delete) para el mismo
      // período/etiqueta — el índice único no libera el slot con active:false,
      // así que la reactivamos en vez de intentar crear una nueva y chocar.
      const existente = await Suscripcion.findOne({ clubId: req.user.clubId, socioId, etiquetaId, fechaDesde }).session(session);

      if (existente) {
        const before = existente.toObject();
        existente.active = true;
        existente.planId = planDoc?._id ?? null;
        existente.fechaHasta = fechaHasta ?? null;
        existente.exento = Boolean(planDoc?.noGeneraDeuda);
        existente.updatedBy = getActor(req);
        await existente.save({ session });
        logAudit({ clubId: req.user?.clubId, req, action: 'UPDATE', resource: 'Suscripcion', resourceId: existente._id, before, after: existente.toObject() });
        suscripcion = existente;
      } else {
        suscripcion = new Suscripcion({
          clubId: req.user.clubId,
          socioId,
          planId: planDoc?._id ?? null,
          etiquetaId,
          fechaDesde,
          fechaHasta: fechaHasta ?? null,
          exento: Boolean(planDoc?.noGeneraDeuda),
          createdBy: getActor(req),
          updatedBy: getActor(req),
        });

        await suscripcion.save({ session });
        logAudit({ clubId: req.user?.clubId, req, action: 'CREATE', resource: 'Suscripcion', resourceId: suscripcion._id, before: null, after: suscripcion.toObject() });
      }

      // Si el plan es de escuelita, "Asignar plan" desde Detalle de socio tiene
      // que dejar a la persona anotada como alumna de escuelita también — si
      // no, queda cobrando sin aparecer en la lista de alumnos (appcarc-backend#52).
      if (planDoc?.tipo === 'escuelita') {
        await sincronizarFichaEscuelita({ clubId: req.user.clubId, socioId, socio, planDoc, req, session });
      }
    });

    return res.status(201).json(suscripcion);
  } catch (error) {
    console.error('Error creando suscripción:', error);
    return res.status(500).json({ message: 'Error al crear suscripción' });
  } finally {
    session.endSession();
  }
};

