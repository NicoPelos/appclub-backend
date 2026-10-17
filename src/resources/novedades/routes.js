import express from 'express';
import { protect, authorize } from '../../middleware/auth.js';
import { PERMISOS } from '../../constants/permisos.js';
import { getNovedadesHandler } from './handlers/getNovedades.handler.js';
import { createNovedadHandler } from './handlers/createNovedad.handler.js';
import { syncNovedadesHandler } from './handlers/syncNovedades.handler.js';

const router = express.Router();

router.get('/', protect, getNovedadesHandler);
router.post('/', protect, authorize(PERMISOS.NOVEDADES_WRITE), createNovedadHandler);
router.post('/sync', protect, authorize(PERMISOS.NOVEDADES_WRITE), syncNovedadesHandler);

export default router;
