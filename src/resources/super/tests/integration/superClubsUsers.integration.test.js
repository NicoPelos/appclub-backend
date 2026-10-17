import { describe, it, expect } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../../../index.js';
import Club from '../../../clubs/models/Club.js';
import User from '../../../usuarios/models/User.js';
import { CLUB_ID, createAdminUser, createSocio, getOrCreateRol } from '../../../../testUtils/integrationHelpers.js';

describe('POST /api/super/clubs (integración)', () => {
  it('crea un club nuevo', async () => {
    const { token } = await createAdminUser();

    const res = await request(app)
      .post('/api/super/clubs')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'Club Andino Test', slug: 'CAT' });

    expect(res.status).toBe(201);
    // Verbatim, sin normalizar mayúsculas/minúsculas — ver el comentario
    // grande en Club.js: el resto del sistema (User.clubId, Socio.clubId,
    // getClubs.handler.js contando por club.slug tal cual) asume slug
    // verbatim; forzarlo a minúscula ya rompió producción una vez (#75).
    expect(res.body.slug).toBe('CAT');
  });

  it('rechaza un slug duplicado (409)', async () => {
    const { token } = await createAdminUser();
    await request(app).post('/api/super/clubs').set('Authorization', `Bearer ${token}`).send({ nombre: 'A', slug: 'dup' });

    const res = await request(app).post('/api/super/clubs').set('Authorization', `Bearer ${token}`).send({ nombre: 'B', slug: 'dup' });
    expect(res.status).toBe(409);
  });

  it('rechaza sin nombre o slug (400)', async () => {
    const { token } = await createAdminUser();
    const res = await request(app).post('/api/super/clubs').set('Authorization', `Bearer ${token}`).send({ nombre: 'Sin slug' });
    expect(res.status).toBe(400);
  });

  it('rechaza el acceso a un usuario que no es superadmin (403)', async () => {
    const rolAdmin = await getOrCreateRol({ clubId: CLUB_ID, nombre: 'admin' });
    const user = await User.create({
      email: 'admin-no-super@carc.local', password: 'x', roles: [rolAdmin._id], clubId: CLUB_ID,
    });
    const token = jwt.sign({ id: user._id, roles: ['admin'], clubId: user.clubId }, process.env.JWT_SECRET, { expiresIn: '1h' });

    const res = await request(app).get('/api/super/clubs').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/super/clubs (integración)', () => {
  it('devuelve los clubs con métricas de usuarios y socios activos', async () => {
    const { token } = await createAdminUser();
    // club.slug se usa verbatim contra clubId en todo el sistema (ver el
    // comentario grande en Club.js) — para que getClubsHandler cuente bien,
    // el slug del Club tiene que coincidir exactamente con el clubId que
    // usan los Socio, sin normalizar mayúscula/minúscula de ningún lado.
    await Club.create({ nombre: 'Club Andino Rio Cuarto', slug: CLUB_ID });
    await createSocio({ clubId: CLUB_ID });
    await createSocio({ clubId: CLUB_ID });

    const res = await request(app).get('/api/super/clubs').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const club = res.body.find((c) => c.slug === CLUB_ID);
    expect(club.socioCount).toBe(2);
  });
});

describe('PATCH /api/super/clubs/:id/suspend (integración)', () => {
  it('suspende y reactiva un club', async () => {
    const { token } = await createAdminUser();
    const club = await Club.create({ nombre: 'Suspendible', slug: 'suspendible' });

    const suspendRes = await request(app).patch(`/api/super/clubs/${club._id}/suspend`).set('Authorization', `Bearer ${token}`);
    expect(suspendRes.status).toBe(200);
    expect(suspendRes.body.active).toBe(false);
    expect(suspendRes.body.suspendidoAt).toBeTruthy();

    const reactivateRes = await request(app).patch(`/api/super/clubs/${club._id}/suspend`).set('Authorization', `Bearer ${token}`);
    expect(reactivateRes.status).toBe(200);
    expect(reactivateRes.body.active).toBe(true);
    expect(reactivateRes.body.suspendidoAt).toBeNull();
  });
});

describe('POST /api/super/users (integración)', () => {
  it('crea un usuario admin para un club con contraseña temporal', async () => {
    const { token } = await createAdminUser();
    await getOrCreateRol({ clubId: CLUB_ID, nombre: 'admin' });
    // appcarc-backend#240: el handler rechaza clubId que no tenga un Club
    // real — este test quedó desactualizado cuando se agregó ese chequeo.
    await Club.create({ nombre: 'Club Andino Rio Cuarto', slug: CLUB_ID });

    const res = await request(app)
      .post('/api/super/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'nuevo-admin@carc.local', nombre: 'Nuevo Admin', clubId: CLUB_ID });

    expect(res.status).toBe(201);
    expect(res.body.tempPassword).toBeTruthy();
    expect(res.body.user.roles).toEqual(['admin']);
  });

  it('rechaza un email duplicado en el mismo club (409)', async () => {
    const { token } = await createAdminUser();
    await getOrCreateRol({ clubId: CLUB_ID, nombre: 'admin' });
    await Club.create({ nombre: 'Club Andino Rio Cuarto', slug: CLUB_ID });
    await request(app).post('/api/super/users').set('Authorization', `Bearer ${token}`).send({ email: 'dup@carc.local', clubId: CLUB_ID });

    const res = await request(app).post('/api/super/users').set('Authorization', `Bearer ${token}`).send({ email: 'dup@carc.local', clubId: CLUB_ID });
    expect(res.status).toBe(409);
  });
});

describe('GET /api/super/users (integración)', () => {
  it('filtra usuarios por clubId y rol', async () => {
    const { token } = await createAdminUser();
    const rolSecretariaCarc = await getOrCreateRol({ clubId: CLUB_ID, nombre: 'secretaria' });
    const rolAdminOtro = await getOrCreateRol({ clubId: 'OTRO_CLUB', nombre: 'admin' });
    await User.create({
      email: 'secretaria@carc.local', password: 'x', roles: [rolSecretariaCarc._id], clubId: CLUB_ID,
    });
    await User.create({
      email: 'admin@otro.local', password: 'x', roles: [rolAdminOtro._id], clubId: 'OTRO_CLUB',
    });

    const res = await request(app)
      .get(`/api/super/users?clubId=${CLUB_ID}&rol=secretaria`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0].email).toBe('secretaria@carc.local');
    expect(res.body.users[0].password).toBeUndefined();
  });
});
