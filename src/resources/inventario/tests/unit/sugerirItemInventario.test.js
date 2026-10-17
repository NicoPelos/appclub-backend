import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('sharp', () => ({
  default: () => ({ resize: () => ({ jpeg: () => ({ toBuffer: async () => Buffer.from('jpeg') }) }) }),
}));

vi.mock('../../models/CategoriaInventario.js', () => ({
  default: { find: vi.fn() },
}));

import CategoriaInventario from '../../models/CategoriaInventario.js';
import { sugerirItemInventarioHandler } from '../../handlers/sugerirItemInventario.handler.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const req = { file: { mimetype: 'image/jpeg', buffer: Buffer.from('foto') }, user: { clubId: 'CARC' } };

const respondeGemini = (texto) => ({
  ok: true,
  json: async () => ({ candidates: [{ content: { parts: [{ text: texto }] } }] }),
});

describe('sugerirItemInventarioHandler', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'clave-de-prueba';
    CategoriaInventario.find = vi.fn().mockReturnValue({
      select: () => ({ lean: async () => [{ nombre: 'Cuerdas' }, { nombre: 'Cascos' }] }),
    });
  });
  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
    vi.unstubAllGlobals();
  });

  it('responde 503 si no hay clave configurada', async () => {
    delete process.env.GEMINI_API_KEY;
    const res = mockRes();
    await sugerirItemInventarioHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('devuelve la propuesta y acepta solo categorías del club', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respondeGemini(JSON.stringify({
      nombre: 'Casco azul', categoria: 'Cascos', descripcion: 'Casco de escalada en buen estado.',
    }))));
    const res = mockRes();
    await sugerirItemInventarioHandler(req, res);
    expect(res.json).toHaveBeenCalledWith({ nombre: 'Casco azul', categoria: 'Cascos', descripcion: 'Casco de escalada en buen estado.' });
  });

  it('descarta una categoría que no existe en el club', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respondeGemini(JSON.stringify({ nombre: 'Bici', categoria: 'Bicicletas', descripcion: '' }))));
    const res = mockRes();
    await sugerirItemInventarioHandler(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ categoria: '' }));
  });

  it('responde 502 si la respuesta no es JSON válido', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respondeGemini('no es json')));
    const res = mockRes();
    await sugerirItemInventarioHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(502);
  });

  it('responde 502 si Gemini devuelve error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    const res = mockRes();
    await sugerirItemInventarioHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(502);
  });
});
