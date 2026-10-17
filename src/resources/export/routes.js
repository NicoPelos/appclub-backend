import express from 'express';
import { protect, authorize } from '../../middleware/auth.js';
import { PERMISOS } from '../../constants/permisos.js';
import { syncSheetsHandler } from './handlers/syncSheets.handler.js';

const router = express.Router();

router.post('/sheets', protect, authorize(PERMISOS.EXPORT_SHEETS), syncSheetsHandler);

export default router;
