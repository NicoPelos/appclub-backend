import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRecursoHandler } from '../../handlers/createRecurso.handler.js';

const mockSave = vi.fn();
vi.mock('../../models/RecursoExterno.js', () => {
  const RecursoMock = vi.fn().mockImplementation((data) => ({ ...data, save: mockSave, toObject: vi.fn().mockReturnValue(data) }));
  return { default: RecursoMock };
});

const mockUser = { clubId: 'CARC', email: 'admin@carc.com' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const validBody = {
  tipo: 'topo',
  provincia: 'Córdoba',
  nombre: 'Los Gigantes',
  descripcion: 'Zona de bloques y vías deportivas',
  url: 'https://www.thecrag.com/es/climbing/argentina/los-gigantes',
};

beforeEach(() => vi.clearAllMocks());

describe('createRecursoHandler', () => {
  it('crea recurso correctamente (201)', async () => {
    mockSave.mockResolvedValue();
    const req = { user: mockUser, body: validBody };
    const res = mockRes();

    await createRecursoHandler(req, res);

    expect(mockSave).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('retorna 400 si falta tipo', async () => {
    const req = { user: mockUser, body: { ...validBody, tipo: undefined } };
    const res = mockRes();

    await createRecursoHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('tipo') }));
  });

  it('retorna 400 si tipo es inválido', async () => {
    const req = { user: mockUser, body: { ...validBody, tipo: 'via-ferrata' } };
    const res = mockRes();

    await createRecursoHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('tipo') }));
  });

  it('retorna 400 si falta provincia', async () => {
    const req = { user: mockUser, body: { ...validBody, provincia: undefined } };
    const res = mockRes();

    await createRecursoHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('provincia') }));
  });

  it('retorna 400 si falta nombre', async () => {
    const req = { user: mockUser, body: { ...validBody, nombre: undefined } };
    const res = mockRes();

    await createRecursoHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('nombre') }));
  });

  it('retorna 400 si falta url', async () => {
    const req = { user: mockUser, body: { ...validBody, url: undefined } };
    const res = mockRes();

    await createRecursoHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('url') }));
  });

  it('retorna 500 si hay error al guardar', async () => {
    mockSave.mockRejectedValue(new Error('DB error'));
    const req = { user: mockUser, body: validBody };
    const res = mockRes();

    await createRecursoHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
