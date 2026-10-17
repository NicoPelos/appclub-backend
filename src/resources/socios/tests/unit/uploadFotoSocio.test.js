import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('sharp', () => ({
  default: vi.fn().mockReturnValue({
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toFile: vi.fn().mockResolvedValue({}),
  }),
}));

vi.mock('multer', () => {
  const multerFn = vi.fn().mockReturnValue({ single: vi.fn() });
  multerFn.memoryStorage = vi.fn().mockReturnValue({});
  return { default: multerFn };
});

vi.mock('../../models/Socio.js', () => ({
  default: { findOne: vi.fn() },
}));

import { uploadFotoSocioHandler } from '../../handlers/uploadFotoSocio.handler.js';
import Socio from '../../models/Socio.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const mockSave = vi.fn();
const baseSocio = { _id: 'socio1', fotoPerfil: null, save: mockSave };

beforeEach(() => vi.clearAllMocks());

describe('uploadFotoSocioHandler', () => {
  it('sube foto correctamente', async () => {
    Socio.findOne.mockResolvedValue({ ...baseSocio, save: mockSave });
    mockSave.mockResolvedValue();

    const req = {
      user: { clubId: 'CARC', role: 'admin', email: 'admin@carc.com' },
      params: { id: 'socio1' },
      file: { buffer: Buffer.from('img'), mimetype: 'image/jpeg' },
    };
    const res = mockRes();
    await uploadFotoSocioHandler(req, res);

    expect(mockSave).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ fotoPerfil: expect.any(String) }));
  });

  it('retorna 400 si no se recibe archivo', async () => {
    Socio.findOne.mockResolvedValue(baseSocio);

    const req = {
      user: { clubId: 'CARC', role: 'admin', email: 'admin@carc.com' },
      params: { id: 'socio1' },
      file: undefined,
    };
    const res = mockRes();
    await uploadFotoSocioHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 403 si socio intenta modificar otro socio', async () => {
    const req = {
      user: { clubId: 'CARC', roles: ['socio'], socioId: 'otro', email: 'socio@carc.com' },
      params: { id: 'socio1' },
      file: { buffer: Buffer.from('img') },
    };
    const res = mockRes();
    await uploadFotoSocioHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('#190: un staff que además es socio NO recibe 403 al subir la foto de otro socio', async () => {
    Socio.findOne.mockResolvedValue(null);
    const req = {
      user: { clubId: 'CARC', roles: ['profesor', 'socio'], socioId: 'otro', email: 'prof@carc.com' },
      params: { id: 'socio1' },
      file: { buffer: Buffer.from('img') },
    };
    const res = mockRes();
    await uploadFotoSocioHandler(req, res);

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 404 si socio no existe', async () => {
    Socio.findOne.mockResolvedValue(null);

    const req = {
      user: { clubId: 'CARC', role: 'admin', email: 'admin@carc.com' },
      params: { id: 'socio1' },
      file: { buffer: Buffer.from('img') },
    };
    const res = mockRes();
    await uploadFotoSocioHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 500 si hay error al procesar', async () => {
    Socio.findOne.mockRejectedValue(new Error('DB'));

    const req = {
      user: { clubId: 'CARC', role: 'admin', email: 'admin@carc.com' },
      params: { id: 'socio1' },
      file: { buffer: Buffer.from('img') },
    };
    const res = mockRes();
    await uploadFotoSocioHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
