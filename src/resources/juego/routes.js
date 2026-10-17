import express from 'express';
import { protect, authorize } from '../../middleware/auth.js';
import { PERMISOS } from '../../constants/permisos.js';
import { registrarPuntajeHandler } from './handlers/registrarPuntaje.handler.js';
import { getPodioHandler } from './handlers/getPodio.handler.js';

const router = express.Router();

// juego:jugar — asignable por rol (por defecto lo trae 'socio', ver
// scripts/seed-roles.js), así un club puede sacárselo a un rol si no lo
// quiere habilitado para ese perfil.
router.post('/puntaje', protect, authorize(PERMISOS.JUEGO_JUGAR), registrarPuntajeHandler);
router.get('/podio', protect, authorize(PERMISOS.JUEGO_JUGAR), getPodioHandler);

export default router;
