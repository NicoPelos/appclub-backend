import { describe, it, expect } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../../../index.js';
import User from '../../../usuarios/models/User.js';
import Rol from '../../models/Rol.js';
import { CLUB_ID, createAdminUser, createSocio, getOrCreateRol } from '../../../../testUtils/integrationHelpers.js';

// El Rol ya existe (creado vía POST /api/roles en el propio test) — acá solo
// se resuelve su ObjectId/slug para armar el User y el JWT.
const crearUsuarioConRol = async (nombreRol) => {
  const rol = await Rol.findOne({ clubId: CLUB_ID, nombre: nombreRol });
  const user = await User.create({
    email: `${nombreRol}-${Date.now()}@carc.local`,
    password: 'hashed-not-used',
    roles: [rol._id],
    clubId: CLUB_ID,
  });
  const token = jwt.sign({ id: user._id, roles: [rol.slug], clubId: user.clubId }, process.env.JWT_SECRET, { expiresIn: '1h' });
  return { user, token };
};

describe('authorize() con roles reales de la base (integración)', () => {
  it('un rol con solo socios:read puede leer pero no crear socios (403)', async () => {
    const { token: adminToken } = await createAdminUser();

    const rolRes = await request(app)
      .post('/api/roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'lector', permisos: ['socios:read'] });
    expect(rolRes.status).toBe(201);

    const { token } = await crearUsuarioConRol('lector');

    const getRes = await request(app).get('/api/socios').set('Authorization', `Bearer ${token}`);
    expect(getRes.status).toBe(200);

    const postRes = await request(app)
      .post('/api/socios')
      .set('Authorization', `Bearer ${token}`)
      .send({ apellido: 'Test', nombre: 'Test', dni: '11111111' });
    expect(postRes.status).toBe(403);
  });

  it('ampliar los permisos del rol via PUT habilita el acceso sin relogin (verifica invalidación de caché)', async () => {
    const { token: adminToken } = await createAdminUser();

    const rolRes = await request(app)
      .post('/api/roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'ampliable', permisos: ['socios:read'] });
    const rolId = rolRes.body._id;

    const { token } = await crearUsuarioConRol('ampliable');

    const antes = await request(app)
      .post('/api/socios')
      .set('Authorization', `Bearer ${token}`)
      .send({ apellido: 'Test', nombre: 'Test', dni: '22222222' });
    expect(antes.status).toBe(403);

    const updateRes = await request(app)
      .put(`/api/roles/${rolId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ permisos: ['socios:read', 'socios:create'] });
    expect(updateRes.status).toBe(200);

    const despues = await request(app)
      .post('/api/socios')
      .set('Authorization', `Bearer ${token}`)
      .send({ apellido: 'Test', nombre: 'Test', dni: '33333333' });
    expect(despues.status).toBe(201);
  });

  it('un rol sin ningún permiso relevante recibe 403 en un recurso protegido (cobros)', async () => {
    const { token: adminToken } = await createAdminUser();
    await request(app)
      .post('/api/roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'sinpermisos', permisos: [] });

    const { token } = await crearUsuarioConRol('sinpermisos');

    const res = await request(app).get('/api/cobros').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('un socio no puede ver la lista de socios del club (sin socios:read)', async () => {
    const socio = await createSocio();
    const rolSocio = await getOrCreateRol({ clubId: CLUB_ID, nombre: 'socio' });
    const user = await User.create({
      email: `socio-${Date.now()}@carc.local`,
      password: 'hashed-not-used',
      roles: [rolSocio._id],
      clubId: CLUB_ID,
      socioId: String(socio._id),
    });
    const token = jwt.sign({ id: user._id, roles: [rolSocio.slug], clubId: user.clubId, socioId: user.socioId }, process.env.JWT_SECRET, { expiresIn: '1h' });

    const res = await request(app).get('/api/socios').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
