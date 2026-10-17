import mongoose from 'mongoose';
import CategoriaInventario, { CATEGORIAS_POR_DEFECTO } from '../models/CategoriaInventario.js';
import ItemInventario from '../models/ItemInventario.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { getActor } from '../../../services/getActor.js';

const SIN_DEFECTOS = 'club-sin-categorias';
const MAX_NOMBRE = 40;

// La primera vez que un club mira sus categorías, se le cargan las de por
// defecto. Desde ahí, manda lo que el club cree, renombre o borre.
const asegurarDefectos = async (clubId) => {
  const existe = await CategoriaInventario.exists({ clubId });
  if (existe) return;
  await CategoriaInventario.insertMany(
    CATEGORIAS_POR_DEFECTO.map((nombre) => ({ clubId, nombre, createdBy: SIN_DEFECTOS })),
    { ordered: false },
  ).catch(() => {});
};

const nombreValido = (valor) => {
  const nombre = typeof valor === 'string' ? valor.trim() : '';
  if (!nombre) return { error: 'El nombre de la categoría es obligatorio' };
  if (nombre.length > MAX_NOMBRE) return { error: `El nombre de la categoría no puede superar los ${MAX_NOMBRE} caracteres` };
  return { nombre };
};

const conflictoNombre = (nombre) => `Ya existe la categoría "${nombre}"`;

export const getCategoriasInventarioHandler = async (req, res) => {
  try {
    const clubId = req.user?.clubId;
    await asegurarDefectos(clubId);
    const categorias = await CategoriaInventario.find({ clubId }).sort({ nombre: 1 }).select('nombre').lean();
    res.status(200).json(categorias);
  } catch (error) {
    console.error('Error listando categorías de inventario:', error);
    res.status(500).json({ message: 'Error al obtener las categorías' });
  }
};

export const createCategoriaInventarioHandler = async (req, res) => {
  try {
    const clubId = req.user?.clubId;
    const { nombre, error } = nombreValido(req.body?.nombre);
    if (error) return res.status(400).json({ message: error });

    await asegurarDefectos(clubId);
    const actor = getActor(req);
    try {
      const categoria = await CategoriaInventario.create({ clubId, nombre, createdBy: actor });
      logAudit({ clubId, req, action: 'CREATE', resource: 'CategoriaInventario', resourceId: categoria._id, before: null, after: categoria.toObject() });
      res.status(201).json({ _id: categoria._id, nombre: categoria.nombre });
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ message: conflictoNombre(nombre) });
      throw error;
    }
  } catch (error) {
    console.error('Error creando categoría de inventario:', error);
    res.status(500).json({ message: 'Error al crear la categoría' });
  }
};

// Renombrar también actualiza los ítems que usaban el nombre viejo, así no
// quedan ítems con una categoría que ya no existe.
export const updateCategoriaInventarioHandler = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'ID inválido' });
    const { nombre, error } = nombreValido(req.body?.nombre);
    if (error) return res.status(400).json({ message: error });

    const clubId = req.user?.clubId;
    const categoria = await CategoriaInventario.findOne({ _id: id, clubId });
    if (!categoria) return res.status(404).json({ message: 'Categoría no encontrada' });

    const antes = categoria.toObject();
    const nombreAnterior = categoria.nombre;
    categoria.nombre = nombre;
    try {
      await categoria.save();
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ message: conflictoNombre(nombre) });
      throw error;
    }
    await ItemInventario.updateMany({ clubId, categoria: nombreAnterior }, { $set: { categoria: nombre } });

    logAudit({ clubId, req, action: 'UPDATE', resource: 'CategoriaInventario', resourceId: categoria._id, before: antes, after: categoria.toObject() });
    res.status(200).json({ _id: categoria._id, nombre: categoria.nombre });
  } catch (error) {
    console.error('Error renombrando categoría de inventario:', error);
    res.status(500).json({ message: 'Error al renombrar la categoría' });
  }
};

// No se borra una categoría que todavía tiene ítems: primero hay que pasarlos a otra.
export const deleteCategoriaInventarioHandler = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'ID inválido' });

    const clubId = req.user?.clubId;
    const categoria = await CategoriaInventario.findOne({ _id: id, clubId });
    if (!categoria) return res.status(404).json({ message: 'Categoría no encontrada' });

    const enUso = await ItemInventario.countDocuments({ clubId, active: true, categoria: categoria.nombre });
    if (enUso > 0) {
      return res.status(409).json({ message: `No se puede borrar "${categoria.nombre}": todavía tiene ${enUso} ítem${enUso === 1 ? '' : 's'}. Cambiales la categoría primero.` });
    }

    const antes = categoria.toObject();
    await categoria.deleteOne();
    logAudit({ clubId, req, action: 'DELETE', resource: 'CategoriaInventario', resourceId: categoria._id, before: antes, after: null });
    res.status(200).json({ message: 'Categoría eliminada' });
  } catch (error) {
    console.error('Error borrando categoría de inventario:', error);
    res.status(500).json({ message: 'Error al borrar la categoría' });
  }
};

export default getCategoriasInventarioHandler;
