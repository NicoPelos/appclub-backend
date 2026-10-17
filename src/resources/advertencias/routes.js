import express from 'express';
import { protect, authorize } from '../../middleware/auth.js';
import { PERMISOS } from '../../constants/permisos.js';
import { getAdvertenciasHandler } from './handlers/getAdvertencias.handler.js';

const router = express.Router();

router.get('/', protect, authorize(PERMISOS.ADVERTENCIAS_READ), getAdvertenciasHandler);

export default router;
