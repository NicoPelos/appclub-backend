import express from 'express';
import { protect, authorize } from '../../middleware/auth.js';
import { PERMISOS } from '../../constants/permisos.js';
import { getPreciosHandler } from './handlers/getPrecios.handler.js';
import { createPrecioHandler } from './handlers/createPrecio.handler.js';
import { updatePrecioHandler } from './handlers/updatePrecio.handler.js';
import { deletePrecioHandler } from './handlers/deletePrecio.handler.js';

const router = express.Router();

router.get('/', protect, authorize(PERMISOS.PRECIOS_READ), getPreciosHandler);
router.post('/', protect, authorize(PERMISOS.PRECIOS_WRITE), createPrecioHandler);
router.put('/:id', protect, authorize(PERMISOS.PRECIOS_WRITE), updatePrecioHandler);
router.delete('/:id', protect, authorize(PERMISOS.PRECIOS_DELETE), deletePrecioHandler);

export default router;
