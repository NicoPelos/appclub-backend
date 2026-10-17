import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../index.js';
import { createAdminUser } from '../../../../testUtils/integrationHelpers.js';

describe('POST /api/novedades (integración)', () => {
  it('crea una novedad manual', async () => {
    const { token } = await createAdminUser();

    const res = await request(app)
      .post('/api/novedades')
      .set('Authorization', `Bearer ${token}`)
      .send({ titulo: 'Cierre por feriado', cuerpo: 'El club cierra el lunes', categoria: 'aviso' });

    expect(res.status).toBe(201);
    expect(res.body.fuente).toBe('manual');
    expect(res.body.titulo).toBe('Cierre por feriado');
  });

  it('rechaza una novedad sin título (400)', async () => {
    const { token } = await createAdminUser();
    const res = await request(app)
      .post('/api/novedades')
      .set('Authorization', `Bearer ${token}`)
      .send({ cuerpo: 'sin titulo' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/novedades (integración)', () => {
  it('permite crear más de una novedad manual (verifica el fix del índice sparse) y filtra por categoría', async () => {
    const { token } = await createAdminUser();
    const primera = await request(app).post('/api/novedades').set('Authorization', `Bearer ${token}`).send({ titulo: 'Aviso 1', categoria: 'aviso' });
    expect(primera.status).toBe(201);
    const segunda = await request(app).post('/api/novedades').set('Authorization', `Bearer ${token}`).send({ titulo: 'Evento 1', categoria: 'evento' });
    expect(segunda.status).toBe(201);

    const res = await request(app).get('/api/novedades?categoria=aviso').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.novedades[0].titulo).toBe('Aviso 1');
  });
});
