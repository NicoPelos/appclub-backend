import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEtiquetaHandler } from '../../handlers/createEtiqueta.handler.js';

const mockSave = vi.fn();
vi.mock('../../models/Etiqueta.js', () => {
  const EtiquetaMock = vi.fn().mockImplementation((data) => ({ ...data, save: mockSave, toObject: vi.fn().mockReturnValue(data) }));
  EtiquetaMock.findOne = vi.fn();
  return { default: EtiquetaMock };
});

import Etiqueta from '../../models/Etiqueta.js';

const mockUser = { clubId: 'CARC', email: 'admin@carc.com' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const validBody = {
  nombre: 'Cuota Social',
  unidad: 'mes',
};

beforeEach(() => vi.clearAllMocks());

describe('createEtiquetaHandler', () => {
  it('crea etiqueta correctamente (201)', async () => {
    mockSave.mockResolvedValue();
    const req = { user: mockUser, body: validBody };
    const res = mockRes();

    await createEtiquetaHandler(req, res);

    expect(mockSave).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('retorna 400 si falta nombre', async () => {
    const req = { user: mockUser, body: { ...validBody, nombre: undefined } };
    const res = mockRes();

    await createEtiquetaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('nombre') }));
  });

  it('retorna 400 si falta unidad', async () => {
    const req = { user: mockUser, body: { ...validBody, unidad: undefined } };
    const res = mockRes();

    await createEtiquetaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('unidad') }));
  });

  it('retorna 400 si unidad es inválida', async () => {
    const req = { user: mockUser, body: { ...validBody, unidad: 'semana' } };
    const res = mockRes();

    await createEtiquetaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('unidad') }));
  });

  it('retorna 500 si hay error al guardar', async () => {
    mockSave.mockRejectedValue(new Error('DB error'));
    const req = { user: mockUser, body: validBody };
    const res = mockRes();

    await createEtiquetaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('crea etiqueta con uso_sistema cuando no hay otra activa con ese valor en el club', async () => {
    mockSave.mockResolvedValue();
    Etiqueta.findOne.mockResolvedValue(null);
    const req = { user: mockUser, body: { ...validBody, uso_sistema: 'cuota_social' } };
    const res = mockRes();

    await createEtiquetaHandler(req, res);

    expect(Etiqueta.findOne).toHaveBeenCalledWith({ clubId: 'CARC', uso_sistema: 'cuota_social', active: true });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('retorna 400 si ya existe otra etiqueta activa con el mismo uso_sistema en el club', async () => {
    Etiqueta.findOne.mockResolvedValue({ _id: 'otra-etiqueta', uso_sistema: 'cuota_social' });
    const req = { user: mockUser, body: { ...validBody, uso_sistema: 'cuota_social' } };
    const res = mockRes();

    await createEtiquetaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('uso_sistema') }));
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('no chequea colisión de uso_sistema si no se envía', async () => {
    mockSave.mockResolvedValue();
    const req = { user: mockUser, body: validBody };
    const res = mockRes();

    await createEtiquetaHandler(req, res);

    expect(Etiqueta.findOne).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
