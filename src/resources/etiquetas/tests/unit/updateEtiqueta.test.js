import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateEtiquetaHandler } from '../../handlers/updateEtiqueta.handler.js';

vi.mock('../../models/Etiqueta.js', () => ({
  default: { findOne: vi.fn() },
}));

import Etiqueta from '../../models/Etiqueta.js';

const mockUser = { clubId: 'CARC', email: 'admin@carc.com' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => vi.clearAllMocks());

describe('updateEtiquetaHandler', () => {
  it('actualiza etiqueta correctamente (200)', async () => {
    const mockSave = vi.fn().mockResolvedValue();
    const etiqueta = { _id: '1', nombre: 'Cuota Social', save: mockSave, toObject: vi.fn().mockReturnValue({}) };
    Etiqueta.findOne.mockResolvedValue(etiqueta);

    const req = { user: mockUser, params: { id: '1' }, body: { nombre: 'Cuota Social Actualizada' } };
    const res = mockRes();

    await updateEtiquetaHandler(req, res);

    expect(mockSave).toHaveBeenCalled();
    expect(etiqueta.nombre).toBe('Cuota Social Actualizada');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('actualiza uso_sistema correctamente cuando no hay otra etiqueta activa con ese valor', async () => {
    const mockSave = vi.fn().mockResolvedValue();
    const etiqueta = { _id: '1', uso_sistema: null, save: mockSave, toObject: vi.fn().mockReturnValue({}) };
    Etiqueta.findOne
      .mockResolvedValueOnce(etiqueta) // fetch por id
      .mockResolvedValueOnce(null); // chequeo de colisión

    const req = { user: mockUser, params: { id: '1' }, body: { uso_sistema: 'cuota_social' } };
    const res = mockRes();

    await updateEtiquetaHandler(req, res);

    expect(Etiqueta.findOne).toHaveBeenCalledWith({
      clubId: 'CARC', uso_sistema: 'cuota_social', active: true, _id: { $ne: '1' },
    });
    expect(etiqueta.uso_sistema).toBe('cuota_social');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('retorna 400 si ya existe otra etiqueta activa con el mismo uso_sistema', async () => {
    const mockSave = vi.fn().mockResolvedValue();
    const etiqueta = { _id: '1', uso_sistema: null, save: mockSave, toObject: vi.fn().mockReturnValue({}) };
    Etiqueta.findOne
      .mockResolvedValueOnce(etiqueta) // fetch por id
      .mockResolvedValueOnce({ _id: 'otra-etiqueta', uso_sistema: 'cuota_social' }); // colisión

    const req = { user: mockUser, params: { id: '1' }, body: { uso_sistema: 'cuota_social' } };
    const res = mockRes();

    await updateEtiquetaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('uso_sistema') }));
    expect(mockSave).not.toHaveBeenCalled();
    expect(etiqueta.uso_sistema).toBeNull();
  });

  it('normaliza uso_sistema vacío a null sin chequear colisión', async () => {
    const mockSave = vi.fn().mockResolvedValue();
    const etiqueta = { _id: '1', uso_sistema: 'cuota_social', save: mockSave, toObject: vi.fn().mockReturnValue({}) };
    Etiqueta.findOne.mockResolvedValueOnce(etiqueta); // fetch por id (única llamada)

    const req = { user: mockUser, params: { id: '1' }, body: { uso_sistema: '' } };
    const res = mockRes();

    await updateEtiquetaHandler(req, res);

    expect(Etiqueta.findOne).toHaveBeenCalledTimes(1);
    expect(etiqueta.uso_sistema).toBeNull();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('retorna 404 si no existe', async () => {
    Etiqueta.findOne.mockResolvedValue(null);

    const req = { user: mockUser, params: { id: '1' }, body: { nombre: 'Nuevo nombre' } };
    const res = mockRes();

    await updateEtiquetaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Etiqueta no encontrada' }));
  });

  it('retorna 500 si hay error', async () => {
    Etiqueta.findOne.mockRejectedValue(new Error('DB error'));

    const req = { user: mockUser, params: { id: '1' }, body: {} };
    const res = mockRes();

    await updateEtiquetaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
