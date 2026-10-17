import { Router } from 'express';
import { protect, authorize } from '../../middleware/auth.js';
import { getRolesHandler } from './handlers/getRoles.handler.js';
import { createRolHandler } from './handlers/createRol.handler.js';
import { updateRolHandler } from './handlers/updateRol.handler.js';
import { deleteRolHandler } from './handlers/deleteRol.handler.js';
import { PERMISOS } from '../../constants/permisos.js';

const router = Router();

router.get('/',       protect, authorize(PERMISOS.ROLES_READ),   getRolesHandler);
router.post('/',      protect, authorize(PERMISOS.ROLES_WRITE),  createRolHandler);
router.put('/:id',   protect, authorize(PERMISOS.ROLES_WRITE),  updateRolHandler);
router.delete('/:id', protect, authorize(PERMISOS.ROLES_DELETE), deleteRolHandler);

export default router;
