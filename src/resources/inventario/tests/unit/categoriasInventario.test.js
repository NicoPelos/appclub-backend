import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../audit/services/audit.service.js', () => ({ logAudit: vi.fn() }));
vi.mock('../../models/ItemInventario.js', () => ({
  default: { updateMany: vi.fn().mockResolvedValue({}), countDocuments: vi.fn().mockResolvedValue(0) },
}));
vi.mock('../../models/CategoriaInventario.js', () => {
  const CategoriaInventario = vi.fn();
  CategoriaInventario.exists = vi.fn();
  CategoriaInventario.insertMany = vi.fn().mockResolvedValue([]);
  CategoriaInventario.find = vi.fn();
  CategoriaInventario.create = vi.fn();
  CategoriaInventario.findOne = vi.fn();
  return {
    default: CategoriaInventario,
    CATEGORIAS_POR_DEFECTO: ['Cuerdas', 'Otros'],
  };
});

import CategoriaInventario from '../../models/CategoriaInventario.js';
import ItemInventario from '../../models/ItemInventario.js';
import { createCategoriaInventarioHandler, updateCategoriaInventarioHandler, deleteCategoriaInventarioHandler } from '../../handlers/categoriasInventario.handler.js';

const USER = { id: 'u1', email: 'staff@club.ar', clubId: 'CARC' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

describe('createCategoriaInventarioHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    CategoriaInventario.exists.mockResolvedValue(true);
  });

  it('rechaza un nombre vacío', async () => {
    const res = mockRes();
    await createCategoriaInventarioHandler({ body: { nombre: '   ' }, user: USER }, res);
    expect(CategoriaInventario.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('responde 409 si la categoría ya existe (sin distinguir mayúsculas)', async () => {
    CategoriaInventario.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));
    const res = mockRes();
    await createCategoriaInventarioHandler({ body: { nombre: 'cuerdas' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('crea la categoría del club del staff', async () => {
    CategoriaInventario.create.mockResolvedValue({ nombre: 'Bicis', _id: 'c1', toObject: () => ({}) });
    const res = mockRes();
    await createCategoriaInventarioHandler({ body: { nombre: ' Bicis ' }, user: USER }, res);
    expect(CategoriaInventario.create).toHaveBeenCalledWith({ clubId: 'CARC', nombre: 'Bicis', createdBy: 'staff@club.ar' });
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('renombrar y borrar categorías', () => {
  const ID = '507f1f77bcf86cd799439011';

  beforeEach(() => {
    vi.clearAllMocks();
    CategoriaInventario.exists.mockResolvedValue(true);
  });

  it('renombrar actualiza los ítems del club que usaban el nombre anterior', async () => {
    const categoria = { _id: ID, nombre: 'Cuerdas', save: vi.fn().mockResolvedValue({}), toObject: () => ({}) };
    CategoriaInventario.findOne.mockResolvedValue(categoria);
    const res = mockRes();
    await updateCategoriaInventarioHandler({ params: { id: ID }, body: { nombre: 'Sogas' }, user: USER }, res);
    expect(ItemInventario.updateMany).toHaveBeenCalledWith({ clubId: 'CARC', categoria: 'Cuerdas' }, { $set: { categoria: 'Sogas' } });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('no deja borrar una categoría que todavía tiene ítems', async () => {
    CategoriaInventario.findOne.mockResolvedValue({ _id: ID, nombre: 'Cuerdas', deleteOne: vi.fn(), toObject: () => ({}) });
    ItemInventario.countDocuments.mockResolvedValueOnce(3);
    const res = mockRes();
    await deleteCategoriaInventarioHandler({ params: { id: ID }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('borra una categoría sin ítems', async () => {
    const deleteOne = vi.fn().mockResolvedValue({});
    CategoriaInventario.findOne.mockResolvedValue({ _id: ID, nombre: 'Bicis', deleteOne, toObject: () => ({}) });
    ItemInventario.countDocuments.mockResolvedValueOnce(0);
    const res = mockRes();
    await deleteCategoriaInventarioHandler({ params: { id: ID }, user: USER }, res);
    expect(deleteOne).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
