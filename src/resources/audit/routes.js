import { Router } from 'express';
import { protect } from '../../middleware/auth.js';
import { authorize } from '../../middleware/auth.js';
import { PERMISOS } from '../../constants/permisos.js';
import getAuditLogsHandler from './handlers/getAuditLogs.handler.js';
import revertAuditLogHandler from './handlers/revertAuditLog.handler.js';

const router = Router();

router.get('/', protect, authorize(PERMISOS.AUDIT_READ), getAuditLogsHandler);
router.post('/:id/revert', protect, authorize(PERMISOS.AUDIT_REVERT), revertAuditLogHandler);

export default router;
