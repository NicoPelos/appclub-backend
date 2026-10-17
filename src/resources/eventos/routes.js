import express from 'express';
import { protect, authorize } from '../../middleware/auth.js';
import { PERMISOS } from '../../constants/permisos.js';
import { crearEventoHandler } from './handlers/crearEvento.handler.js';
import { getEventosHandler } from './handlers/getEventos.handler.js';
import { getEventoHandler } from './handlers/getEvento.handler.js';
import { updateEventoHandler } from './handlers/updateEvento.handler.js';
import { cerrarEventoHandler } from './handlers/cerrarEvento.handler.js';
import { crearEventoParticipanteHandler } from './handlers/crearEventoParticipante.handler.js';
import { getEventoParticipantesHandler } from './handlers/getEventoParticipantes.handler.js';
import { updateEventoParticipanteHandler } from './handlers/updateEventoParticipante.handler.js';
import { anularEventoParticipanteHandler } from './handlers/anularEventoParticipante.handler.js';
import { registrarPagoEventoParticipanteHandler } from './handlers/registrarPagoEventoParticipante.handler.js';
import { anularPagoEventoParticipanteHandler } from './handlers/anularPagoEventoParticipante.handler.js';
import { cambiarFormaPagoEventoParticipanteHandler } from './handlers/cambiarFormaPagoEventoParticipante.handler.js';
import { getResumenEconomicoEventoHandler } from './handlers/getResumenEconomicoEvento.handler.js';

const router = express.Router();

router.get('/', protect, authorize(PERMISOS.EVENTOS_READ), getEventosHandler);
router.post('/', protect, authorize(PERMISOS.EVENTOS_WRITE), crearEventoHandler);
router.get('/:id', protect, authorize(PERMISOS.EVENTOS_READ), getEventoHandler);
router.put('/:id', protect, authorize(PERMISOS.EVENTOS_WRITE), updateEventoHandler);
router.post('/:id/cerrar', protect, authorize(PERMISOS.EVENTOS_WRITE), cerrarEventoHandler);
router.get('/:id/resumen-economico', protect, authorize(PERMISOS.EVENTOS_READ), getResumenEconomicoEventoHandler);

router.get('/:eventoId/participantes', protect, authorize(PERMISOS.EVENTOS_READ), getEventoParticipantesHandler);
router.post('/:eventoId/participantes', protect, authorize(PERMISOS.EVENTOS_WRITE), crearEventoParticipanteHandler);
router.put('/:eventoId/participantes/:participanteId', protect, authorize(PERMISOS.EVENTOS_WRITE), updateEventoParticipanteHandler);
router.post('/:eventoId/participantes/:participanteId/anular', protect, authorize(PERMISOS.EVENTOS_DELETE), anularEventoParticipanteHandler);

router.post('/:eventoId/participantes/:participanteId/pagos', protect, authorize(PERMISOS.EVENTOS_WRITE), registrarPagoEventoParticipanteHandler);
router.delete('/:eventoId/participantes/:participanteId/pagos/:movimientoId', protect, authorize(PERMISOS.EVENTOS_DELETE), anularPagoEventoParticipanteHandler);

// Requiere ambos permisos: internamente anula el pago original (eventos:delete)
// y registra uno nuevo con la forma de pago corregida (eventos:write).
router.put(
  '/:eventoId/participantes/:participanteId/pagos/:movimientoId/forma-pago',
  protect, authorize(PERMISOS.EVENTOS_WRITE), authorize(PERMISOS.EVENTOS_DELETE),
  cambiarFormaPagoEventoParticipanteHandler,
);

export default router;
