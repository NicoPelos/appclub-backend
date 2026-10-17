import AuditLog from '../models/AuditLog.js';

export const logAudit = async ({ clubId, req, action, resource, resourceId, before, after }) => {
  try {
    await AuditLog.create({
      clubId,
      userId: req.user.id,
      userEmail: req.user.email || String(req.user.id),
      action,
      resource,
      resourceId,
      before: before ?? null,
      after: after ?? null,
      endpoint: `${req.method} ${req.originalUrl}`,
      ipAddress: req.ip || req.headers?.['x-forwarded-for'] || '',
    });
  } catch (err) {
    console.error('[AuditLog] Error guardando log:', err.message);
  }
};
