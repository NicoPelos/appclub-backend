import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import Precios from '../../models/Precios.js';
import { findPrecioVigente } from '../../services/findPrecioVigente.service.js';
import { resolverVigenciaPrecio } from '../../services/resolverVigenciaPrecio.service.js';
import { createEtiqueta, createPrecio, CLUB_ID } from '../../../../testUtils/integrationHelpers.js';

// Caracterización contra Mongo real (appcarc-backend#263,
// docs/specs/cuotas-calcularDeuda.md §2 y §4). Fija lo que pasa HOY; los
// tests con código D2 son dudas abiertas, no comportamiento aprobado; D5 ya
// está corregido.
const D = (iso) => new Date(iso);

const buscar = (etiquetaId, date, clubId = CLUB_ID) => findPrecioVigente({ clubId, etiquetaId, date });

describe('findPrecioVigente (integración, caracterización #263)', () => {
  it('sin precios devuelve null', async () => {
    const etiqueta = await createEtiqueta();
    expect(await buscar(etiqueta._id, D('2026-10-11'))).toBeNull();
  });

  it('C15: con dos precios abiertos solapados gana el de vigenteDesde más reciente', async () => {
    const etiqueta = await createEtiqueta();
    await createPrecio({ etiquetaId: etiqueta._id, monto: 12000, vigenteDesde: D('2026-06-01') });
    await createPrecio({ etiquetaId: etiqueta._id, monto: 18000, vigenteDesde: D('2026-09-01') });

    expect((await buscar(etiqueta._id, D('2026-10-11'))).monto).toBe(18000);
    expect((await buscar(etiqueta._id, D('2026-08-15'))).monto).toBe(12000);
  });

  // C15 pasa aunque se saque el .sort: el índice { clubId, etiquetaId, vigenteDesde: -1 }
  // ya devuelve en ese orden (lo mostró Stryker, #263). Sin ese índice, el orden
  // queda en manos del planner (inserción o vigenteDesde ascendente), y el monto
  // correcto depende solo del .sort.
  it('C15b: el de vigenteDesde más reciente gana por el sort, no por el índice compuesto', async () => {
    const indice = (await Precios.collection.indexes()).find((i) => i.key.clubId === 1 && i.key.etiquetaId === 1 && i.key.vigenteDesde === -1);
    expect(indice).toBeDefined();
    await Precios.collection.dropIndex(indice.name);
    try {
      const etiqueta = await createEtiqueta();
      await createPrecio({ etiquetaId: etiqueta._id, monto: 12000, vigenteDesde: D('2026-06-01') });
      await createPrecio({ etiquetaId: etiqueta._id, monto: 18000, vigenteDesde: D('2026-09-01') });

      expect((await buscar(etiqueta._id, D('2026-10-11'))).monto).toBe(18000);
    } finally {
      await Precios.collection.createIndex(indice.key, { name: indice.name });
    }
  });

  it('las dos puntas son inclusivas y se comparan como instantes', async () => {
    const etiqueta = await createEtiqueta();
    await createPrecio({ etiquetaId: etiqueta._id, monto: 15000, vigenteDesde: D('2026-08-01T00:00:00.000Z'), vigenteHasta: D('2026-08-31T00:00:00.000Z') });

    expect(await buscar(etiqueta._id, D('2026-07-31T23:59:59.999Z'))).toBeNull();
    expect((await buscar(etiqueta._id, D('2026-08-01T00:00:00.000Z'))).monto).toBe(15000);
    expect((await buscar(etiqueta._id, D('2026-08-31T00:00:00.000Z'))).monto).toBe(15000);
    // El 31/08 al mediodía ya no rige: vigenteHasta es un instante, no un día.
    expect(await buscar(etiqueta._id, D('2026-08-31T12:00:00.000Z'))).toBeNull();
  });

  it('ignora precios inactivos, de otra etiqueta y de otro club', async () => {
    const etiqueta = await createEtiqueta();
    const otraEtiqueta = await createEtiqueta({ nombre: 'Escuelita', uso_sistema: null });
    await createPrecio({ etiquetaId: etiqueta._id, monto: 1, vigenteDesde: D('2026-01-01'), active: false });
    await createPrecio({ etiquetaId: otraEtiqueta._id, monto: 2, vigenteDesde: D('2026-01-01') });
    await createPrecio({ etiquetaId: etiqueta._id, monto: 3, vigenteDesde: D('2026-01-01'), clubId: 'OTRO' });

    expect(await buscar(etiqueta._id, D('2026-10-11'))).toBeNull();
    expect((await buscar(etiqueta._id, D('2026-10-11'), 'OTRO')).monto).toBe(3);
  });

  it('devuelve un objeto plano (lean), no un documento de Mongoose', async () => {
    const etiqueta = await createEtiqueta();
    await createPrecio({ etiquetaId: etiqueta._id, vigenteDesde: D('2026-01-01') });
    const precio = await buscar(etiqueta._id, D('2026-10-11'));
    expect(precio).not.toBeInstanceOf(mongoose.Document);
    expect(typeof precio.save).toBe('undefined');
  });

  it('con sesión, ve lo escrito dentro de la misma transacción', async () => {
    const etiqueta = await createEtiqueta();
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await mongoose.model('Precios').create([{
          clubId: CLUB_ID, etiquetaId: etiqueta._id, nombre: 'x', unidad: 'mes', monto: 777, vigenteDesde: D('2026-01-01'), createdBy: 'test',
        }], { session });
        const enSesion = await findPrecioVigente({ clubId: CLUB_ID, etiquetaId: etiqueta._id, date: D('2026-10-11'), session });
        expect(enSesion.monto).toBe(777);
      });
    } finally {
      await session.endSession();
    }
  });

  it('D2: hueco entre precios devuelve null — comportamiento actual, pendiente de decidir', async () => {
    // Flujo real de createPrecio con confirmarCierre: el anterior se cierra
    // en desde − 24 h = 31/07 00:00 UTC, y el nuevo recién arranca el 01/08.
    const etiqueta = await createEtiqueta();
    const anterior = await createPrecio({ etiquetaId: etiqueta._id, monto: 15000, vigenteDesde: D('2026-06-26T00:00:00.000Z') });
    const desde = D('2026-08-01T00:00:00.000Z');
    await resolverVigenciaPrecio({ clubId: CLUB_ID, etiquetaId: etiqueta._id, desde, hasta: null, confirmado: true });
    await createPrecio({ etiquetaId: etiqueta._id, monto: 18000, vigenteDesde: desde });

    const cerrado = await mongoose.model('Precios').findById(anterior._id).lean();
    expect(cerrado.vigenteHasta.toISOString()).toBe('2026-07-31T00:00:00.000Z');

    expect((await buscar(etiqueta._id, D('2026-07-31T00:00:00.000Z'))).monto).toBe(15000);
    // 31/07 09:00 hora argentina: no hay ningún precio vigente.
    expect(await buscar(etiqueta._id, D('2026-07-31T12:00:00.000Z'))).toBeNull();
    // 30/07 22:00 hora argentina ya cae en el hueco.
    expect(await buscar(etiqueta._id, D('2026-07-31T01:00:00.000Z'))).toBeNull();
    expect((await buscar(etiqueta._id, desde)).monto).toBe(18000);
  });

  it('D5: no deja cerrar un anterior más largo que el nuevo; el tramo final sigue con precio', async () => {
    const etiqueta = await createEtiqueta();
    const anterior = await createPrecio({ etiquetaId: etiqueta._id, monto: 15000, vigenteDesde: D('2026-06-01T00:00:00.000Z'), vigenteHasta: D('2026-12-31T00:00:00.000Z') });
    const desde = D('2026-08-01T00:00:00.000Z');
    const hasta = D('2026-08-31T00:00:00.000Z');
    await expect(resolverVigenciaPrecio({ clubId: CLUB_ID, etiquetaId: etiqueta._id, desde, hasta, confirmado: true }))
      .rejects.toMatchObject({ name: 'BusinessError', status: 409 });

    const intacto = await mongoose.model('Precios').findById(anterior._id).lean();
    expect(intacto.vigenteHasta.toISOString()).toBe('2026-12-31T00:00:00.000Z');
    expect((await buscar(etiqueta._id, D('2026-10-15T12:00:00.000Z'))).monto).toBe(15000);
  });
});
