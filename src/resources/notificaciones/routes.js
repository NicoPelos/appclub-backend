import express from 'express';
import { protect } from '../../middleware/auth.js';
import { getMisNotificacionesHandler } from './handlers/getMisNotificaciones.handler.js';
import { markNotificacionLeidaHandler } from './handlers/markNotificacionLeida.handler.js';
import { deleteNotificacionesLeidasHandler } from './handlers/deleteNotificacionesLeidas.handler.js';

const router = express.Router();

router.get('/me', protect, getMisNotificacionesHandler);
router.put('/:id/leida', protect, markNotificacionLeidaHandler);
router.delete('/leidas', protect, deleteNotificacionesLeidasHandler);

export default router;
