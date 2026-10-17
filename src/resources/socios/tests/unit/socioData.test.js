import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../../clubs/models/Club.js', () => ({ default: { findOneAndUpdate: vi.fn() } }));

import Club from '../../../clubs/models/Club.js';
import {
  buildDomicilioCompleto,
  prepareSocioCreateData,
  prepareSocioUpdateData,
  asignarSocioNumber,
} from '../../services/socioData.service.js';

beforeEach(() => vi.clearAllMocks());

describe('buildDomicilioCompleto', () => {
  it('returns domicilioCompleto when present', () => {
    expect(buildDomicilioCompleto({ domicilioCompleto: 'Av. Siempreviva 742' }))
      .toBe('Av. Siempreviva 742');
  });

  it('returns calle + altura when both present', () => {
    expect(buildDomicilioCompleto({ calle: 'Mitre', altura: '123' })).toBe('Mitre 123');
  });

  it('returns only calle when altura is missing', () => {
    expect(buildDomicilioCompleto({ calle: 'Mitre' })).toBe('Mitre');
  });

  it('returns direccionActual as fallback', () => {
    expect(buildDomicilioCompleto({ direccionActual: 'Belgrano 500' })).toBe('Belgrano 500');
  });

  it('returns undefined when no address fields are present', () => {
    expect(buildDomicilioCompleto({})).toBeUndefined();
  });

  it('returns undefined when called with no argument', () => {
    expect(buildDomicilioCompleto()).toBeUndefined();
  });

  it('prefers domicilioCompleto over calle', () => {
    expect(buildDomicilioCompleto({ domicilioCompleto: 'Principal', calle: 'Otra' }))
      .toBe('Principal');
  });
});

describe('prepareSocioCreateData', () => {
  const USER = { id: 'u1', clubId: 'club1' };

  it('sets clubId from user when not in body', () => {
    const result = prepareSocioCreateData({ nombre: 'Juan' }, USER);
    expect(result.clubId).toBe('club1');
  });

  it('ignora clubId del body — siempre usa el del usuario autenticado (appcarc-backend#163)', () => {
    const result = prepareSocioCreateData({ nombre: 'Juan', clubId: 'club-ajeno' }, USER);
    expect(result.clubId).toBe('club1');
  });

  it('ignora active/deletedAt/deletedBy/sheetRowNumber/spreadsheetId del body (appcarc-backend#163)', () => {
    const result = prepareSocioCreateData({
      nombre: 'Juan',
      active: false,
      deletedAt: new Date(),
      deletedBy: 'atacante@test.com',
      sheetRowNumber: 999,
      spreadsheetId: 'otro-sheet',
    }, USER);
    expect(result.active).toBeUndefined();
    expect(result.deletedAt).toBeUndefined();
    expect(result.deletedBy).toBeUndefined();
    expect(result.sheetRowNumber).toBeUndefined();
    expect(result.spreadsheetId).toBeUndefined();
  });

  it('sets createdBy and updatedBy from user.id', () => {
    const result = prepareSocioCreateData({}, USER);
    expect(result.createdBy).toBe('u1');
    expect(result.updatedBy).toBe('u1');
  });

  it('merges domicilioCompleto from calle + altura', () => {
    const result = prepareSocioCreateData({ calle: 'San Martín', altura: '200' }, USER);
    expect(result.domicilioCompleto).toBe('San Martín 200');
  });

  it('asigna fechaDeAsociado = hoy cuando no viene en el body', () => {
    const antes = Date.now();
    const result = prepareSocioCreateData({ nombre: 'Juan' }, USER);
    expect(result.fechaDeAsociado).toBeInstanceOf(Date);
    expect(result.fechaDeAsociado.getTime()).toBeGreaterThanOrEqual(antes);
  });

  it('respeta fechaDeAsociado cuando viene en el body (ej. importación con fecha real)', () => {
    const fecha = new Date('2019-03-15');
    const result = prepareSocioCreateData({ nombre: 'Juan', fechaDeAsociado: fecha }, USER);
    expect(result.fechaDeAsociado).toBe(fecha);
  });
});

describe('prepareSocioUpdateData', () => {
  const USER = { id: 'u1', clubId: 'club1' };

  it('sets updatedBy from user.id', () => {
    const result = prepareSocioUpdateData({ nombre: 'Ana' }, USER);
    expect(result.updatedBy).toBe('u1');
  });

  it('does not set createdBy', () => {
    const result = prepareSocioUpdateData({}, USER);
    expect(result.createdBy).toBeUndefined();
  });

  it('merges domicilioCompleto from direccionActual', () => {
    const result = prepareSocioUpdateData({ direccionActual: 'Av. Central 1' }, USER);
    expect(result.domicilioCompleto).toBe('Av. Central 1');
  });

  it('ignora socioNumber en el body (inmutable una vez asignado)', () => {
    const result = prepareSocioUpdateData({ nombre: 'Ana', socioNumber: '999' }, USER);
    expect(result.socioNumber).toBeUndefined();
  });

  it('ignora clubId del body — no permite mover un socio existente a otro club (appcarc-backend#163)', () => {
    const result = prepareSocioUpdateData({ nombre: 'Ana', clubId: 'club-ajeno' }, USER);
    expect(result.clubId).toBeUndefined();
  });

  it('ignora active/deletedAt/deletedBy/sheetRowNumber/spreadsheetId del body (appcarc-backend#163)', () => {
    const result = prepareSocioUpdateData({
      nombre: 'Ana',
      active: false,
      deletedAt: new Date(),
      deletedBy: 'atacante@test.com',
      sheetRowNumber: 999,
      spreadsheetId: 'otro-sheet',
    }, USER);
    expect(result.active).toBeUndefined();
    expect(result.deletedAt).toBeUndefined();
    expect(result.deletedBy).toBeUndefined();
    expect(result.sheetRowNumber).toBeUndefined();
    expect(result.spreadsheetId).toBeUndefined();
  });

  it('appcarc-backend#230: descarta operadores de Mongo ($set) que podrían pisar campos protegidos', () => {
    const result = prepareSocioUpdateData({
      nombre: 'Ana',
      $set: { clubId: 'club-ajeno', active: false },
    }, USER);
    expect(result.$set).toBeUndefined();
    expect(result.clubId).toBeUndefined();
    expect(result.active).toBeUndefined();
  });
});

describe('asignarSocioNumber', () => {
  it('incrementa el contador del club de forma atómica y devuelve el nuevo valor como string', async () => {
    Club.findOneAndUpdate.mockResolvedValue({ ultimoSocioNumber: 8 });

    const result = await asignarSocioNumber('CARC');

    expect(Club.findOneAndUpdate).toHaveBeenCalledWith(
      { slug: 'CARC' },
      { $inc: { ultimoSocioNumber: 1 } },
      { new: true }
    );
    expect(result).toBe('8');
  });

  it('devuelve undefined si el club no existe', async () => {
    Club.findOneAndUpdate.mockResolvedValue(null);
    const result = await asignarSocioNumber('noexiste');
    expect(result).toBeUndefined();
  });
});
