import express from 'express';
import { protect, authorize } from '../../middleware/auth.js';
import { PERMISOS } from '../../constants/permisos.js';
import { getRecursosHandler } from './handlers/getRecursos.handler.js';
import { createRecursoHandler } from './handlers/createRecurso.handler.js';
import { updateRecursoHandler } from './handlers/updateRecurso.handler.js';
import { deleteRecursoHandler } from './handlers/deleteRecurso.handler.js';

const router = express.Router();

router.get('/', protect, authorize(PERMISOS.RECURSOS_READ), getRecursosHandler);
router.post('/', protect, authorize(PERMISOS.RECURSOS_WRITE), createRecursoHandler);
router.put('/:id', protect, authorize(PERMISOS.RECURSOS_WRITE), updateRecursoHandler);
router.delete('/:id', protect, authorize(PERMISOS.RECURSOS_DELETE), deleteRecursoHandler);

export default router;
