import express from 'express';
import { protect, authorize } from '../../middleware/auth.js';
import { PERMISOS } from '../../constants/permisos.js';
import { getPlanesHandler } from './handlers/getPlanes.handler.js';
import { createPlanHandler } from './handlers/createPlan.handler.js';
import { updatePlanHandler } from './handlers/updatePlan.handler.js';
import { deletePlanHandler } from './handlers/deletePlan.handler.js';

const router = express.Router();

router.get('/', protect, authorize(PERMISOS.PLANES_READ), getPlanesHandler);
router.post('/', protect, authorize(PERMISOS.PLANES_WRITE), createPlanHandler);
router.put('/:id', protect, authorize(PERMISOS.PLANES_WRITE), updatePlanHandler);
router.delete('/:id', protect, authorize(PERMISOS.PLANES_DELETE), deletePlanHandler);

export default router;
