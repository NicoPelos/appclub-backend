import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/Rol.js', () => ({
  default: { findOne: vi.fn() },
}));

import Rol from '../../models/Rol.js';
import { slugify, generarSlugUnico } from '../../services/slug.service.js';

beforeEach(() => vi.clearAllMocks());

describe('slugify', () => {
  it('pasa a minúsculas y reemplaza espacios por guiones', () => {
    expect(slugify('Profesor Senior')).toBe('profesor-senior');
  });

  it('saca acentos y diacríticos', () => {
    expect(slugify('Cañero')).toBe('canero');
    expect(slugify('Instructor (Núcleo)')).toBe('instructor-nucleo');
  });

  it('colapsa separadores repetidos y saca guiones de los bordes', () => {
    expect(slugify('  Muro   Libre!! ')).toBe('muro-libre');
  });

  it('string vacío o solo símbolos da string vacío', () => {
    expect(slugify('   ')).toBe('');
    expect(slugify('!!!')).toBe('');
  });
});

describe('generarSlugUnico', () => {
  it('devuelve el slug base si no hay colisión', async () => {
    Rol.findOne.mockResolvedValue(null);
    const slug = await generarSlugUnico({ clubId: 'CARC', nombre: 'Entrenador' });
    expect(slug).toBe('entrenador');
  });

  it('desambigua con sufijo numérico si el slug ya existe', async () => {
    Rol.findOne
      .mockResolvedValueOnce({ slug: 'entrenador' })
      .mockResolvedValueOnce(null);
    const slug = await generarSlugUnico({ clubId: 'CARC', nombre: 'Entrenador' });
    expect(slug).toBe('entrenador-2');
  });

  it('sigue incrementando el sufijo si hace falta', async () => {
    Rol.findOne
      .mockResolvedValueOnce({ slug: 'entrenador' })
      .mockResolvedValueOnce({ slug: 'entrenador-2' })
      .mockResolvedValueOnce(null);
    const slug = await generarSlugUnico({ clubId: 'CARC', nombre: 'Entrenador' });
    expect(slug).toBe('entrenador-3');
  });

  it('nombre que slugifica a vacío usa "rol" como base', async () => {
    Rol.findOne.mockResolvedValue(null);
    const slug = await generarSlugUnico({ clubId: 'CARC', nombre: '!!!' });
    expect(slug).toBe('rol');
  });

  it('filtra por active: true (permite reusar el slug de un rol borrado)', async () => {
    Rol.findOne.mockResolvedValue(null);
    await generarSlugUnico({ clubId: 'CARC', nombre: 'Entrenador' });
    expect(Rol.findOne).toHaveBeenCalledWith(expect.objectContaining({ active: true }));
  });

});
