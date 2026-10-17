import mongoose from 'mongoose';
import { RESOLVERS } from '../services/resolveRefs.service.js';

const MAX_REFS = 200;

/**
 * @openapi
 * /api/super/resolve-refs:
 *   post:
 *     summary: Resolver una lista de IDs a un nombre legible (solo superadmin)
 *     description: >
 *       Pensado para el detalle de Auditoría, donde before/after guardan ObjectIds
 *       crudos (socioId, etiquetaId, etc.) sin ningún nombre asociado. Solo resuelve
 *       modelos en un allowlist fijo — no permite leer cualquier colección por ID.
 *     tags: [Super]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refs]
 *             properties:
 *               refs:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     model: { type: string, enum: [Socio, Etiqueta, Plan, Suscripcion, User] }
 *                     id: { type: string }
 *     responses:
 *       200:
 *         description: Lista resuelta (label null si no se encontró o el modelo no es resolvible)
 *       400:
 *         description: refs inválido o con demasiados elementos
 */
export const resolveRefsHandler = async (req, res) => {
  try {
    const { refs } = req.body;

    if (!Array.isArray(refs) || refs.length === 0) {
      return res.status(400).json({ message: 'refs es requerido y debe ser un array no vacío' });
    }
    if (refs.length > MAX_REFS) {
      return res.status(400).json({ message: `Demasiadas referencias (máx ${MAX_REFS})` });
    }

    const idsPorModelo = new Map();
    for (const ref of refs) {
      if (!ref?.model || !ref?.id) continue;
      if (!RESOLVERS[ref.model]) continue;
      if (!mongoose.isValidObjectId(ref.id)) continue;
      if (!idsPorModelo.has(ref.model)) idsPorModelo.set(ref.model, new Set());
      idsPorModelo.get(ref.model).add(ref.id);
    }

    const results = [];
    await Promise.all([...idsPorModelo.entries()].map(async ([model, idSet]) => {
      const ids = [...idSet];
      const labelPorId = await RESOLVERS[model](ids);
      for (const id of ids) {
        results.push({ model, id, label: labelPorId.get(id) ?? null });
      }
    }));

    res.status(200).json({ results });
  } catch (error) {
    console.error('Error resolviendo referencias:', error);
    res.status(500).json({ message: 'Error al resolver referencias' });
  }
};

