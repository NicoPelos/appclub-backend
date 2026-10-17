import express from 'express';
import { protect, authorize } from '../../middleware/auth.js';
import { PERMISOS } from '../../constants/permisos.js';
import { getAsistenciasHandler } from './handlers/getAsistencias.handler.js';
import { createAsistenciaEscuelitaHandler } from './handlers/createAsistenciaEscuelita.handler.js';
import { updateAsistenciaHandler } from './handlers/updateAsistencia.handler.js';
import { deleteAsistenciaHandler } from './handlers/deleteAsistencia.handler.js';

const router = express.Router();

router.get('/', protect, authorize(PERMISOS.ASISTENCIAS_READ), getAsistenciasHandler);
router.post('/escuelita', protect, authorize(PERMISOS.ASISTENCIAS_WRITE), createAsistenciaEscuelitaHandler);
router.put('/:id', protect, authorize(PERMISOS.ASISTENCIAS_WRITE), updateAsistenciaHandler);
router.delete('/:id', protect, authorize(PERMISOS.ASISTENCIAS_WRITE), deleteAsistenciaHandler);

export default router;
