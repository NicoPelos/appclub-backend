import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

import { BusinessError, crearCargoPuntual } from '../../services/crearCargoPuntual.service.js';
import Socio from '../../../socios/models/Socio.js';
import Etiqueta from '../../../etiquetas/models/Etiqueta.js';
import Precios from '../../../cuotas/models/Precios.js';
import CargoPuntual from '../../models/CargoPuntual.js';

const CLUB_ID = 'club1';
const SOCIO_ID = '507f1f77bcf86cd799439011';
const ETIQUETA_ID = '507f1f77bcf86cd799439088';
const USER = { id: '507f1f77bcf86cd799439012', email: 'secretaria@carc.test' };

const chainableFindOne = (result) => ({ lean: vi.fn().mockResolvedValue(result) });

const validBody = { socioId: SOCIO_ID, etiquetaId: ETIQUETA_ID, description: 'Trekking a Cerro Negro' };

describe('crearCargoPuntual service (unit)', () => {
  let saveSpy;

  beforeEach(() => {
    Socio.findOne = vi.fn().mockReturnValue(chainableFindOne({ _id: SOCIO_ID }));
    Etiqueta.findOne = vi.fn().mockReturnValue(chainableFindOne({ _id: ETIQUETA_ID, nombre: 'Trekking', unidad: 'unico' }));
    Precios.findOne = vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue(chainableFindOne(null)) });

    saveSpy = vi.spyOn(CargoPuntual.prototype, 'save').mockImplementation(async function () {
      if (!this._id) this._id = new mongoose.Types.ObjectId();
      return this;
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('should fail without socioId', async () => {
    await expect(crearCargoPuntual({ clubId: CLUB_ID, user: USER, body: { ...validBody, socioId: '' } }))
      .rejects.toBeInstanceOf(BusinessError);
  });

  it('should fail with 404 when socio not found', async () => {
    Socio.findOne.mockReturnValue(chainableFindOne(null));

    await expect(crearCargoPuntual({ clubId: CLUB_ID, user: USER, body: validBody }))
      .rejects.toMatchObject({ status: 404, message: 'Socio no encontrado' });
  });

  it('should fail with 404 when etiqueta not found', async () => {
    Etiqueta.findOne.mockReturnValue(chainableFindOne(null));

    await expect(crearCargoPuntual({ clubId: CLUB_ID, user: USER, body: validBody }))
      .rejects.toMatchObject({ status: 404, message: 'Etiqueta no encontrada' });
  });

  it('should fail when etiqueta unidad is not unico', async () => {
    Etiqueta.findOne.mockReturnValue(chainableFindOne({ _id: ETIQUETA_ID, nombre: 'Cuota Social', unidad: 'mes' }));

    await expect(crearCargoPuntual({ clubId: CLUB_ID, user: USER, body: validBody }))
      .rejects.toEqual(expect.objectContaining({
        message: 'La etiqueta "Cuota Social" no es de cargo puntual (unidad: mes)',
      }));
  });

  it('#317: sin precio vigente ni monto manual, nombra la etiqueta y el mes y devuelve PRECIO_NO_VIGENTE', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-01T10:00:00.000-03:00'));
    try {
      await expect(crearCargoPuntual({ clubId: CLUB_ID, user: USER, body: validBody }))
        .rejects.toMatchObject({
          status: 400,
          message: 'No hay precio vigente para «Trekking» en diciembre 2026. Cargalo o actualizalo en Etiquetas → Precios para completar la operación.',
          data: { code: 'PRECIO_NO_VIGENTE', etiquetaId: ETIQUETA_ID, etiquetaNombre: 'Trekking', periodo: '2026-12' },
        });
      expect(saveSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // #283: el período del cargo es el mes en curso en hora argentina, no el
  // del reloj del proceso (que en el container es UTC).
  it('#283: el 31/08 a las 23:30 hs de Argentina (02:30 UTC del 01/09) el cargo queda en 2026-08', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-31T23:30:00.000-03:00'));
    try {
      const cargo = await crearCargoPuntual({ clubId: CLUB_ID, user: USER, body: { ...validBody, monto: 1000 } });
      expect(cargo.periodo).toBe('2026-08');
    } finally {
      vi.useRealTimers();
    }
  });

  it('#283: el 01/09 a las 00:30 hs de Argentina el cargo queda en 2026-09', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-01T00:30:00.000-03:00'));
    try {
      const cargo = await crearCargoPuntual({ clubId: CLUB_ID, user: USER, body: { ...validBody, monto: 1000 } });
      expect(cargo.periodo).toBe('2026-09');
    } finally {
      vi.useRealTimers();
    }
  });

  it('should use the precio vigente when no manual monto is given', async () => {
    Precios.findOne.mockReturnValue({ sort: vi.fn().mockReturnValue(chainableFindOne({ monto: 200000 })) });

    const cargo = await crearCargoPuntual({ clubId: CLUB_ID, user: USER, body: validBody });

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(cargo.montoEsperadoSnapshot).toBe(200000);
    expect(cargo.precioSugeridoSnapshot).toBe(200000);
    expect(cargo.estado).toBe('pendiente');
    expect(cargo.createdBy).toBe(USER.email);
  });

  it('should use the manual monto and skip Precios lookup', async () => {
    const cargo = await crearCargoPuntual({
      clubId: CLUB_ID, user: USER, body: { ...validBody, monto: 150000 },
    });

    expect(Precios.findOne).not.toHaveBeenCalled();
    expect(cargo.montoEsperadoSnapshot).toBe(150000);
    expect(cargo.precioSugeridoSnapshot).toBeNull();
  });

  it('should fail with a negative manual monto', async () => {
    await expect(crearCargoPuntual({ clubId: CLUB_ID, user: USER, body: { ...validBody, monto: -1 } }))
      .rejects.toBeInstanceOf(BusinessError);
  });
});
