import express from 'express';
import { protect, authorize } from '../../middleware/auth.js';
import { PERMISOS } from '../../constants/permisos.js';
import { getSuscripcionesHandler } from './handlers/getSuscripciones.handler.js';
import { createSuscripcionHandler } from './handlers/createSuscripcion.handler.js';
import { closeSuscripcionHandler } from './handlers/closeSuscripcion.handler.js';
import { excludePeriodoHandler } from './handlers/excludePeriodo.handler.js';
import { moverInicioHandler } from './handlers/moverInicio.handler.js';
import { setMesesActivosHandler } from './handlers/setMesesActivos.handler.js';
import { deleteSuscripcionHandler } from './handlers/deleteSuscripcion.handler.js';

const router = express.Router();

router.get('/', protect, authorize(PERMISOS.SUSCRIPCIONES_READ), getSuscripcionesHandler);
router.post('/', protect, authorize(PERMISOS.SUSCRIPCIONES_WRITE), createSuscripcionHandler);
router.put('/:id/cerrar', protect, authorize(PERMISOS.SUSCRIPCIONES_CLOSE), closeSuscripcionHandler);
router.put('/:id/excluir-periodo', protect, authorize(PERMISOS.SUSCRIPCIONES_CLOSE), excludePeriodoHandler);
router.put('/:id/mover-inicio', protect, authorize(PERMISOS.SUSCRIPCIONES_CLOSE), moverInicioHandler);
router.put('/socio/:socioId/etiqueta/:etiquetaId/meses', protect, authorize(PERMISOS.SUSCRIPCIONES_CLOSE), setMesesActivosHandler);
router.delete('/:id', protect, authorize(PERMISOS.SUSCRIPCIONES_DELETE), deleteSuscripcionHandler);

export default router;
