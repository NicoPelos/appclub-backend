import express from 'express';
import { protect, authorize, authorizeSelfPadreQueryOr } from '../../middleware/auth.js';
import { PERMISOS } from '../../constants/permisos.js';
import { crearVinculoHandler } from './handlers/crearVinculo.handler.js';
import { getVinculosHandler } from './handlers/getVinculos.handler.js';
import { anularVinculoHandler } from './handlers/anularVinculo.handler.js';

const router = express.Router();

router.get('/', protect, authorizeSelfPadreQueryOr(PERMISOS.SOCIOS_READ), getVinculosHandler);
router.post('/', protect, authorize(PERMISOS.SOCIOS_WRITE), crearVinculoHandler);
router.post('/:id/anular', protect, authorize(PERMISOS.SOCIOS_DELETE), anularVinculoHandler);

export default router;
