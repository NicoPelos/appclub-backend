import express from 'express';
import mongoose from 'mongoose';
import { protect, authorize } from '../../middleware/auth.js';
import { PERMISOS } from '../../constants/permisos.js';
import { getItemsInventarioHandler } from './handlers/getItemsInventario.handler.js';
import { getItemInventarioHandler } from './handlers/getItemInventario.handler.js';
import { createItemInventarioHandler } from './handlers/createItemInventario.handler.js';
import { updateItemInventarioHandler } from './handlers/updateItemInventario.handler.js';
import { deleteItemInventarioHandler } from './handlers/deleteItemInventario.handler.js';
import { getCategoriasInventarioHandler, createCategoriaInventarioHandler, updateCategoriaInventarioHandler, deleteCategoriaInventarioHandler } from './handlers/categoriasInventario.handler.js';
import { uploadFoto, handleUploadFotoError, uploadFotoItemInventarioHandler, deleteFotoItemInventarioHandler } from './handlers/fotosItemInventario.handler.js';
import { sugerirItemInventarioHandler } from './handlers/sugerirItemInventario.handler.js';

const router = express.Router();

router.param('id', (req, res, next, id) => (
  mongoose.isValidObjectId(id) ? next() : res.status(400).json({ message: 'ID inválido' })
));

router.post('/sugerir', protect, authorize(PERMISOS.INVENTARIO_WRITE), uploadFoto.single('foto'), handleUploadFotoError, sugerirItemInventarioHandler);
router.get('/categorias', protect, authorize(PERMISOS.INVENTARIO_READ), getCategoriasInventarioHandler);
router.post('/categorias', protect, authorize(PERMISOS.INVENTARIO_WRITE), createCategoriaInventarioHandler);
router.put('/categorias/:id', protect, authorize(PERMISOS.INVENTARIO_WRITE), updateCategoriaInventarioHandler);
router.delete('/categorias/:id', protect, authorize(PERMISOS.INVENTARIO_DELETE), deleteCategoriaInventarioHandler);
router.get('/', protect, authorize(PERMISOS.INVENTARIO_READ), getItemsInventarioHandler);
router.post('/', protect, authorize(PERMISOS.INVENTARIO_WRITE), createItemInventarioHandler);
router.get('/:id', protect, authorize(PERMISOS.INVENTARIO_READ), getItemInventarioHandler);
router.put('/:id', protect, authorize(PERMISOS.INVENTARIO_WRITE), updateItemInventarioHandler);
router.delete('/:id', protect, authorize(PERMISOS.INVENTARIO_DELETE), deleteItemInventarioHandler);
router.post('/:id/fotos', protect, authorize(PERMISOS.INVENTARIO_WRITE), uploadFoto.single('foto'), handleUploadFotoError, uploadFotoItemInventarioHandler);
router.delete('/:id/fotos/:fotoId', protect, authorize(PERMISOS.INVENTARIO_WRITE), deleteFotoItemInventarioHandler);

export default router;
