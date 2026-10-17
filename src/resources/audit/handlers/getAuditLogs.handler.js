import mongoose from 'mongoose';
import AuditLog from '../models/AuditLog.js';

/**
 * @openapi
 * /api/audit:
 *   get:
 *     summary: Obtener logs de auditoría
 *     tags: [Audit]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: resource
 *         schema: { type: string }
 *         description: Filtrar por recurso (ej. Socio, Cobro)
 *       - in: query
 *         name: userId
 *         schema: { type: string }
 *         description: Filtrar por ID de usuario
 *       - in: query
 *         name: action
 *         schema: { type: string, enum: [CREATE, UPDATE, DELETE] }
 *       - in: query
 *         name: from
 *         schema: { type: string, example: '2026-01' }
 *         description: Desde período YYYY-MM (inclusive)
 *       - in: query
 *         name: to
 *         schema: { type: string, example: '2026-06' }
 *         description: Hasta período YYYY-MM (inclusive)
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50, maximum: 200 }
 *     responses:
 *       200:
 *         description: Lista de logs de auditoría
 */
export const getAuditLogsHandler = async (req, res) => {
  try {
    const { resource, userId, action, from, to } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const filter = { clubId: req.user.clubId };

    // Sin validar, un userId con formato inválido dispara un CastError
    // async (-> 500), y un resource no-string (ej. ?resource[$ne]=x) llega
    // tal cual al filtro de Mongo — operator injection, acotado por clubId
    // pero no intencional (appcarc-backend#223).
    if (resource) {
      if (typeof resource !== 'string') return res.status(400).json({ message: 'resource inválido' });
      filter.resource = resource;
    }
    if (userId) {
      if (!mongoose.isValidObjectId(userId)) return res.status(400).json({ message: 'userId inválido' });
      filter.userId = userId;
    }
    if (action && ['CREATE', 'UPDATE', 'DELETE'].includes(action)) filter.action = action;

    const YYYY_MM = /^\d{4}-(0[1-9]|1[0-2])$/;
    if ((from && !YYYY_MM.test(from)) || (to && !YYYY_MM.test(to))) {
      return res.status(400).json({ message: 'from/to deben tener formato YYYY-MM' });
    }

    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(`${from}-01T00:00:00.000Z`);
      if (to) {
        const [y, m] = to.split('-').map(Number);
        const nextMonth = m === 12 ? new Date(`${y + 1}-01-01T00:00:00.000Z`) : new Date(`${y}-${String(m + 1).padStart(2, '0')}-01T00:00:00.000Z`);
        filter.createdAt.$lt = nextMonth;
      }
    }

    const [total, logs] = await Promise.all([
      AuditLog.countDocuments(filter),
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    res.status(200).json({ page, limit, total, logs });
  } catch (error) {
    console.error('Error obteniendo audit logs:', error);
    res.status(500).json({ message: 'Error al obtener logs de auditoría' });
  }
};

export default getAuditLogsHandler;
