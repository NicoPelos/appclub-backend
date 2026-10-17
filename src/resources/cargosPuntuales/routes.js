import express from 'express';
import { protect, authorize, authorizeSelfYVinculadosOr } from '../../middleware/auth.js';
import { PERMISOS } from '../../constants/permisos.js';
import { crearCargoPuntualHandler } from './handlers/crearCargoPuntual.handler.js';
import { getCargosPuntualesHandler } from './handlers/getCargosPuntuales.handler.js';
import { anularCargoPuntualHandler } from './handlers/anularCargoPuntual.handler.js';

const router = express.Router();

router.get('/', protect, authorizeSelfYVinculadosOr(PERMISOS.COBROS_READ), getCargosPuntualesHandler);
router.post('/', protect, authorize(PERMISOS.COBROS_WRITE), crearCargoPuntualHandler);
router.post('/:id/anular', protect, authorize(PERMISOS.COBROS_DELETE), anularCargoPuntualHandler);

export default router;
