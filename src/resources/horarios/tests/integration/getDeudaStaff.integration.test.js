import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../index.js';
import Horarios from '../../models/Horarios.js';
import { createAdminUser, createSocio, createEtiqueta, createPrecio } from '../../../../testUtils/integrationHelpers.js';

let idCounter = 0;
const crearHorario = ({ socio, etiqueta, fecha, totalHoras }) => Horarios.create({
  clubId: 'CARC',
  socioId: socio._id,
  etiquetaId: etiqueta._id,
  fecha,
  totalHoras,
  idHorarios: `h-${Date.now()}-${idCounter++}`,
  createdBy: 'test',
  updatedBy: 'test',
});

describe('GET /api/horarios/deuda (integración)', () => {
  it('calcula la deuda del club con el staff según horas x precio vigente', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio({ apellido: 'Palestrero', nombre: 'Pedro' });
    const etiqueta = await createEtiqueta({ nombre: 'Hora Palestrero', uso_sistema: null });
    await createPrecio({ etiquetaId: etiqueta._id, monto: 2000, vigenteDesde: new Date('2020-01-01') });

    await crearHorario({ socio, etiqueta, fecha: new Date('2026-03-05'), totalHoras: 4 });
    await crearHorario({ socio, etiqueta, fecha: new Date('2026-03-12'), totalHoras: 6 });

    const res = await request(app)
      .get('/api/horarios/deuda?periodo=2026-03')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].totalDeuda).toBe(10 * 2000);
    expect(res.body[0].detalles[0].totalHoras).toBe(10);
  });

  it('marca sinPrecio cuando no hay un precio vigente configurado para la etiqueta', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    const etiqueta = await createEtiqueta({ nombre: 'Hora Sin Precio', uso_sistema: null });
    await crearHorario({ socio, etiqueta, fecha: new Date('2026-03-05'), totalHoras: 3 });

    const res = await request(app)
      .get('/api/horarios/deuda?periodo=2026-03')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body[0].detalles[0].sinPrecio).toBe(true);
    expect(res.body[0].totalDeuda).toBe(0);
  });

  it('no incluye horarios fuera del período consultado', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    const etiqueta = await createEtiqueta({ uso_sistema: null });
    await createPrecio({ etiquetaId: etiqueta._id, monto: 1000, vigenteDesde: new Date('2020-01-01') });
    await crearHorario({ socio, etiqueta, fecha: new Date('2026-04-01'), totalHoras: 5 });

    const res = await request(app)
      .get('/api/horarios/deuda?periodo=2026-03')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('rechaza un período con formato inválido (400)', async () => {
    const { token } = await createAdminUser();
    const res = await request(app).get('/api/horarios/deuda?periodo=2026/03').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});
