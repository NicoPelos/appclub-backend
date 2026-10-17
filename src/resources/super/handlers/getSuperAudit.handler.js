import AuditLog from '../../audit/models/AuditLog.js';

export const getSuperAuditHandler = async (req, res) => {
  try {
    const { clubId, resource, userId, action, reverted, from, to } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));

    const filter = {};
    if (clubId) filter.clubId = clubId;
    if (resource) filter.resource = resource;
    if (userId) filter.userId = userId;
    if (action && ['CREATE', 'UPDATE', 'DELETE'].includes(action)) filter.action = action;
    // Para la "papelera": un DELETE sin revertir sigue efectivamente borrado;
    // uno ya revertido significa que el documento se restauró, no está en la papelera.
    if (reverted === 'false') filter.revertedAt = null;
    if (reverted === 'true') filter.revertedAt = { $ne: null };

    // from/to sin validar producían un Invalid Date que Mongo no puede
    // serializar, cayendo al catch genérico -> 500 en vez de un 400 claro
    // (appcarc-backend#205).
    const YYYY_MM = /^\d{4}-(0[1-9]|1[0-2])$/;
    if ((from && !YYYY_MM.test(from)) || (to && !YYYY_MM.test(to))) {
      return res.status(400).json({ message: 'from/to deben tener formato YYYY-MM' });
    }

    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(`${from}-01T00:00:00.000Z`);
      if (to) {
        const [y, m] = to.split('-').map(Number);
        const nextMonth = m === 12
          ? new Date(`${y + 1}-01-01T00:00:00.000Z`)
          : new Date(`${y}-${String(m + 1).padStart(2, '0')}-01T00:00:00.000Z`);
        filter.createdAt.$lt = nextMonth;
      }
    }

    const [total, logs] = await Promise.all([
      AuditLog.countDocuments(filter),
      AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);

    res.status(200).json({ page, limit, total, logs });
  } catch (error) {
    console.error('Error obteniendo audit super:', error);
    res.status(500).json({ message: 'Error al obtener logs de auditoría' });
  }
};
