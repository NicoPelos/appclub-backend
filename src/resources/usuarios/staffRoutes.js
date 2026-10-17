import express from 'express';
import { getStaffHandler } from './handlers/getStaff.handler.js';
import { protect, authorize } from '../../middleware/auth.js';
import { PERMISOS } from '../../constants/permisos.js';

const router = express.Router();

router.get('/', protect, authorize(PERMISOS.HORARIOS_READ), getStaffHandler);

export default router;
