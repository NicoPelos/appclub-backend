import express from 'express';
import mongoose from 'mongoose';
import { protectSuper } from '../../middleware/auth.js';

import { getClubsHandler }       from './handlers/getClubs.handler.js';
import { createClubHandler }     from './handlers/createClub.handler.js';
import { updateClubHandler }     from './handlers/updateClub.handler.js';
import { suspendClubHandler }    from './handlers/suspendClub.handler.js';
import { getClubInstagramConfigHandler } from './handlers/getClubInstagramConfig.handler.js';
import { updateClubInstagramConfigHandler } from './handlers/updateClubInstagramConfig.handler.js';
import { getClubMercadoPagoConfigHandler } from './handlers/getClubMercadoPagoConfig.handler.js';
import { updateClubMercadoPagoConfigHandler } from './handlers/updateClubMercadoPagoConfig.handler.js';
import { getUsersHandler }       from './handlers/getUsers.handler.js';
import { createSuperUserHandler }from './handlers/createSuperUser.handler.js';
import { updateSuperUserHandler }from './handlers/updateSuperUser.handler.js';
import { deleteSuperUserHandler }from './handlers/deleteSuperUser.handler.js';
import { resetUserPasswordHandler } from './handlers/resetUserPassword.handler.js';
import { getSuperAuditHandler }  from './handlers/getSuperAudit.handler.js';
import { revertSuperAuditHandler } from './handlers/revertSuperAudit.handler.js';
import { resolveRefsHandler }    from './handlers/resolveRefs.handler.js';
import { getHealthHandler }      from './handlers/getHealth.handler.js';
import { runJobHandler }         from './handlers/runJob.handler.js';
import { getSuperRolesHandler }  from './handlers/getSuperRoles.handler.js';
import { createSuperRolHandler } from './handlers/createSuperRol.handler.js';
import { updateSuperRolHandler } from './handlers/updateSuperRol.handler.js';
import { deleteSuperRolHandler } from './handlers/deleteSuperRol.handler.js';
import { getPermisosCatalogoHandler } from './handlers/getPermisosCatalogo.handler.js';

const router = express.Router();

// Un id que no es ObjectId llegaba a los handlers y terminaba en 500 por
// CastError (appcarc-backend#240).
router.param('id', (req, res, next, id) => (
  mongoose.isValidObjectId(id) ? next() : res.status(400).json({ message: 'ID inválido' })
));

// Clubs
router.get('/clubs',              protectSuper, getClubsHandler);
router.post('/clubs',             protectSuper, createClubHandler);
router.patch('/clubs/:id',        protectSuper, updateClubHandler);
router.patch('/clubs/:id/suspend',protectSuper, suspendClubHandler);
router.get('/clubs/:id/instagram',   protectSuper, getClubInstagramConfigHandler);
router.put('/clubs/:id/instagram',   protectSuper, updateClubInstagramConfigHandler);
router.get('/clubs/:id/mercadopago', protectSuper, getClubMercadoPagoConfigHandler);
router.put('/clubs/:id/mercadopago', protectSuper, updateClubMercadoPagoConfigHandler);

// Usuarios
router.get('/users',                        protectSuper, getUsersHandler);
router.post('/users',                       protectSuper, createSuperUserHandler);
router.patch('/users/:id',                  protectSuper, updateSuperUserHandler);
router.delete('/users/:id',                 protectSuper, deleteSuperUserHandler);
router.post('/users/:id/reset-password',    protectSuper, resetUserPasswordHandler);

// Roles cross-club
router.get('/roles',        protectSuper, getSuperRolesHandler);
router.post('/roles',       protectSuper, createSuperRolHandler);
router.patch('/roles/:id',  protectSuper, updateSuperRolHandler);
router.delete('/roles/:id', protectSuper, deleteSuperRolHandler);
router.get('/permisos',     protectSuper, getPermisosCatalogoHandler);

// Audit cross-club
router.get('/audit', protectSuper, getSuperAuditHandler);
router.post('/audit/:id/revert', protectSuper, revertSuperAuditHandler);
router.post('/resolve-refs', protectSuper, resolveRefsHandler);

// Sistema
router.get('/health',            protectSuper, getHealthHandler);
router.post('/jobs/:nombre/run', protectSuper, runJobHandler);

export default router;
