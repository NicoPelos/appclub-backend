import express from 'express';
import { protect, authorize, authorizeAny } from '../../middleware/auth.js';
import { PERMISOS } from '../../constants/permisos.js';
import { createMuroLibreHandler } from './handlers/createMuroLibre.handler.js';
import { getMuroLibreHandler } from './handlers/getMuroLibre.handler.js';
import { checkinMuroLibreHandler } from './handlers/checkinMuroLibre.handler.js';
import { updateMuroLibreHandler } from './handlers/updateMuroLibre.handler.js';
import { deleteMuroLibreHandler } from './handlers/deleteMuroLibre.handler.js';
import { getPrecioMuroLibreDiarioHandler } from './handlers/getPrecioMuroLibreDiario.handler.js';

const router = express.Router();

router.get('/', protect, authorize(PERMISOS.MURO_LIBRE_READ), getMuroLibreHandler);
router.post('/', protect, authorize(PERMISOS.MURO_LIBRE_WRITE), createMuroLibreHandler);
router.post('/checkin', protect, authorizeAny([PERMISOS.MURO_LIBRE_CHECKIN, PERMISOS.MURO_LIBRE_CHECKIN_PROPIO]), checkinMuroLibreHandler);
router.get('/precio-diario', protect, authorizeAny([PERMISOS.MURO_LIBRE_WRITE, PERMISOS.MURO_LIBRE_CHECKIN]), getPrecioMuroLibreDiarioHandler);
router.put('/:id', protect, authorize(PERMISOS.MURO_LIBRE_WRITE), updateMuroLibreHandler);
router.delete('/:id', protect, authorize(PERMISOS.MURO_LIBRE_DELETE), deleteMuroLibreHandler);

export default router;
