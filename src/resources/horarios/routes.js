import express from 'express';
import { protect, authorize } from '../../middleware/auth.js';
import { PERMISOS } from '../../constants/permisos.js';
import { getHorariosHandler } from './handlers/getHorarios.handler.js';
import { createHorarioHandler } from './handlers/createHorario.handler.js';
import { updateHorarioHandler } from './handlers/updateHorario.handler.js';
import { deleteHorarioHandler } from './handlers/deleteHorario.handler.js';
import { getDeudaStaffHandler } from './handlers/getDeudaStaff.handler.js';
import { getPrecioTareasHandler } from './handlers/getPrecioTareas.handler.js';

const router = express.Router();

// Deuda del staff (antes de /:id para no colisionar)
router.get('/deuda', protect, authorize(PERMISOS.HORARIOS_DEUDA), getDeudaStaffHandler);

// Tipos de tarea (etiquetas de precio con unidad=hora) — accesible con HORARIOS_READ
router.get('/precio-tareas', protect, authorize(PERMISOS.HORARIOS_READ), getPrecioTareasHandler);

// Horarios
router.get('/', protect, authorize(PERMISOS.HORARIOS_READ), getHorariosHandler);
router.post('/', protect, authorize(PERMISOS.HORARIOS_WRITE), createHorarioHandler);
router.put('/:id', protect, authorize(PERMISOS.HORARIOS_WRITE), updateHorarioHandler);
router.delete('/:id', protect, authorize(PERMISOS.HORARIOS_DELETE), deleteHorarioHandler);

export default router;
