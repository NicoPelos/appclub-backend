import express from 'express';
import { protect, authorize } from '../../middleware/auth.js';
import { PERMISOS } from '../../constants/permisos.js';
import { getEtiquetasHandler } from './handlers/getEtiquetas.handler.js';
import { createEtiquetaHandler } from './handlers/createEtiqueta.handler.js';
import { updateEtiquetaHandler } from './handlers/updateEtiqueta.handler.js';
import { deleteEtiquetaHandler } from './handlers/deleteEtiqueta.handler.js';

const router = express.Router();

router.get('/', protect, authorize(PERMISOS.ETIQUETAS_READ), getEtiquetasHandler);
router.post('/', protect, authorize(PERMISOS.ETIQUETAS_WRITE), createEtiquetaHandler);
router.put('/:id', protect, authorize(PERMISOS.ETIQUETAS_WRITE), updateEtiquetaHandler);
router.delete('/:id', protect, authorize(PERMISOS.ETIQUETAS_DELETE), deleteEtiquetaHandler);

export default router;
