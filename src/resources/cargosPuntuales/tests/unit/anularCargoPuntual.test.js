import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BusinessError, anularCargoPuntual } from '../../services/anularCargoPuntual.service.js';
import CargoPuntual from '../../models/CargoPuntual.js';

const CLUB_ID = 'club1';
const CARGO_ID = '507f1f77bcf86cd799439077';
const USER = { id: '507f1f77bcf86cd799439012', email: 'secretaria@carc.test' };

const buildCargo = (overrides = {}) => ({
  _id: CARGO_ID,
  estado: 'pendiente',
  active: true,
  description: 'Trekking a Cerro Negro',
  updatedBy: '',
  save: vi.fn(async function () { return this; }),
  ...overrides,
});

describe('anularCargoPuntual service (unit)', () => {
  beforeEach(() => {
    CargoPuntual.findOne = vi.fn();
  });

  afterEach(() => vi.restoreAllMocks());

  it('should fail with 404 when cargo not found', async () => {
    CargoPuntual.findOne.mockResolvedValue(null);

    await expect(anularCargoPuntual({ clubId: CLUB_ID, user: USER, id: CARGO_ID }))
      .rejects.toBeInstanceOf(BusinessError);
    await expect(anularCargoPuntual({ clubId: CLUB_ID, user: USER, id: CARGO_ID }))
      .rejects.toMatchObject({ status: 404 });
  });

  it('should fail with 409 when cargo is not pendiente', async () => {
    CargoPuntual.findOne.mockResolvedValue(buildCargo({ estado: 'pagada' }));

    await expect(anularCargoPuntual({ clubId: CLUB_ID, user: USER, id: CARGO_ID }))
      .rejects.toMatchObject({ status: 409 });
  });

  it('appcarc-backend#168: should anular a cargo puntual parcial (saldo restante se descarta, lo ya pagado queda como está)', async () => {
    const cargo = buildCargo({ estado: 'parcial', montoPagadoSnapshot: 15000, montoEsperadoSnapshot: 30000 });
    CargoPuntual.findOne.mockResolvedValue(cargo);

    await anularCargoPuntual({ clubId: CLUB_ID, user: USER, id: CARGO_ID });

    expect(cargo.estado).toBe('anulada');
    expect(cargo.active).toBe(false);
    expect(cargo.montoPagadoSnapshot).toBe(15000); // lo ya cobrado no se toca
  });

  it('should anular a pendiente cargo puntual', async () => {
    const cargo = buildCargo();
    CargoPuntual.findOne.mockResolvedValue(cargo);

    const result = await anularCargoPuntual({ clubId: CLUB_ID, user: USER, id: CARGO_ID, motivo: 'Error de carga' });

    expect(cargo.estado).toBe('anulada');
    expect(cargo.active).toBe(false);
    expect(cargo.description).toBe('Trekking a Cerro Negro (anulado: Error de carga)');
    expect(cargo.updatedBy).toBe(USER.email);
    expect(cargo.save).toHaveBeenCalledTimes(1);
    expect(result).toBe(cargo);
  });

  it('should not append motivo suffix when none is given', async () => {
    const cargo = buildCargo();
    CargoPuntual.findOne.mockResolvedValue(cargo);

    await anularCargoPuntual({ clubId: CLUB_ID, user: USER, id: CARGO_ID });

    expect(cargo.description).toBe('Trekking a Cerro Negro');
  });
});
