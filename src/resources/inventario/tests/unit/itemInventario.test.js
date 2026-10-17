import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../audit/services/audit.service.js', () => ({ logAudit: vi.fn() }));
vi.mock('../../models/ItemInventario.js', () => {
  const ItemInventario = vi.fn();
  ItemInventario.create = vi.fn();
  ItemInventario.findOne = vi.fn();
  ItemInventario.countDocuments = vi.fn();
  ItemInventario.find = vi.fn();
  return { default: ItemInventario, ESTADOS_ITEM: ['bueno', 'en_reparacion', 'baja'] };
});

import ItemInventario from '../../models/ItemInventario.js';
import { prepararItem } from '../../services/itemInventario.service.js';
import { createItemInventarioHandler } from '../../handlers/createItemInventario.handler.js';
import { updateItemInventarioHandler } from '../../handlers/updateItemInventario.handler.js';
import { getItemsInventarioHandler } from '../../handlers/getItemsInventario.handler.js';

const VALID_ID = '507f1f77bcf86cd799439011';
const USER = { id: 'u1', email: 'staff@club.ar', clubId: 'CARC' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

describe('prepararItem', () => {
  it('exige nombre', () => {
    expect(prepararItem({ categoria: 'cuerdas' }).error).toBe('El nombre es obligatorio');
  });

  it('rechaza cantidad negativa o fraccionaria', () => {
    expect(prepararItem({ nombre: 'Cuerda', cantidad: -1 }).error).toBeDefined();
    expect(prepararItem({ nombre: 'Cuerda', cantidad: 1.5 }).error).toBeDefined();
  });

  it('rechaza un estado que no existe', () => {
    expect(prepararItem({ nombre: 'Casco', estado: 'perdido' }).error).toBeDefined();
  });

  it('en modo parcial no exige nombre', () => {
    expect(prepararItem({ cantidad: 3 }, { parcial: true })).toEqual({ data: { cantidad: 3 } });
  });

  it('descarta campos que no son del ítem', () => {
    const { data } = prepararItem({ nombre: 'Casco', clubId: 'otro', fotos: [] });
    expect(data).toEqual({ nombre: 'Casco' });
  });
});

describe('createItemInventarioHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('responde 400 sin nombre y no crea nada', async () => {
    const res = mockRes();
    await createItemInventarioHandler({ body: {}, user: USER }, res);
    expect(ItemInventario.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('crea el ítem del club del staff', async () => {
    ItemInventario.create.mockResolvedValue({ _id: VALID_ID, toObject: () => ({}) });
    const res = mockRes();
    await createItemInventarioHandler({ body: { nombre: 'Casco', cantidad: 4 }, user: USER }, res);
    expect(ItemInventario.create).toHaveBeenCalledWith(expect.objectContaining({
      nombre: 'Casco', cantidad: 4, clubId: 'CARC', createdBy: 'staff@club.ar',
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('updateItemInventarioHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('no encuentra ítems de otro club (filtra por clubId)', async () => {
    ItemInventario.findOne.mockResolvedValue(null);
    const res = mockRes();
    await updateItemInventarioHandler({ params: { id: VALID_ID }, body: { cantidad: 2 }, user: USER }, res);
    expect(ItemInventario.findOne).toHaveBeenCalledWith({ _id: VALID_ID, clubId: 'CARC', active: true });
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('getItemsInventarioHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ignora filtros de estado inválidos y escapa la búsqueda', async () => {
    ItemInventario.countDocuments.mockResolvedValue(0);
    ItemInventario.find.mockReturnValue({ sort: () => ({ skip: () => ({ limit: () => ({ lean: () => Promise.resolve([]) }) }) }) });
    const res = mockRes();
    await getItemsInventarioHandler({ query: { estado: 'perdido', search: 'a.b' }, user: USER }, res);
    const filtro = ItemInventario.countDocuments.mock.calls[0][0];
    expect(filtro.estado).toBeUndefined();
    expect(filtro.clubId).toBe('CARC');
    expect(filtro.$or[0].nombre.test('a.b')).toBe(true);
    expect(filtro.$or[0].nombre.test('axb')).toBe(false);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('categorías de inventario', () => {
  it('createItem rechaza una categoría que el club no tiene cargada', async () => {
    vi.clearAllMocks();
    const { default: CategoriaInventario } = await import('../../models/CategoriaInventario.js');
    CategoriaInventario.exists = vi.fn().mockResolvedValue(null);
    const res = mockRes();
    await createItemInventarioHandler({ body: { nombre: 'Cuerda', categoria: 'Inventada' }, user: USER }, res);
    expect(ItemInventario.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
