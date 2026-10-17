import { describe, it, expect } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../../../index.js';
import Asistencia from '../../../asistencias/models/Asistencia.js';
import Advertencia from '../../models/Advertencia.js';
import User from '../../../usuarios/models/User.js';
import { CLUB_ID, createAdminUser, createSocio } from '../../../../testUtils/integrationHelpers.js';

// asistencias:read (asistencia/check-in propios o de alumnos) es un permiso
// distinto de advertencias:read (panel de contacto con datos de todo el
// club) — un rol con el primero pero no el segundo no debe poder ver esto.
// Crea el Rol vía POST /api/roles (no Rol.create directo) porque ese endpoint
// invalida permisosCache — igual que en authorizePermisos.integration.test.js.
const crearUsuarioConPermisos = async (permisos) => {
  const { token: adminToken } = await createAdminUser();
  const nombre = `rol-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const rolRes = await request(app)
    .post('/api/roles')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ nombre, permisos });

  const user = await User.create({
    email: `${nombre}@carc.local`,
    password: 'hashed-not-used',
    roles: [rolRes.body._id],
    clubId: CLUB_ID,
  });
  const token = jwt.sign({ id: user._id, roles: [rolRes.body.slug], clubId: user.clubId }, process.env.JWT_SECRET, { expiresIn: '1h' });
  return { user, token };
};

const crearAsistenciaConAdvertencia = async ({
  socio, tipo = 'escuelita', codigo = 'CUOTA_SOCIAL_IMPAGA', fecha = new Date(),
}) => Asistencia.create({
  clubId: 'CARC',
  tipo,
  socioId: socio._id,
  nombre: socio.nombre,
  apellido: socio.apellido,
  dni: socio.dni,
  esSocio: true,
  fecha,
  advertencias: [{ codigo, mensaje: `Advertencia ${codigo}` }],
  createdBy: 'test',
  updatedBy: 'test',
});

describe('GET /api/advertencias (integración)', () => {
  it('solo lista asistencias que tienen advertencias', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    await crearAsistenciaConAdvertencia({ socio });
    await Asistencia.create({
      clubId: 'CARC', tipo: 'escuelita', socioId: socio._id, nombre: socio.nombre, apellido: socio.apellido, esSocio: true, fecha: new Date(), advertencias: [], createdBy: 'test', updatedBy: 'test',
    });

    const res = await request(app).get('/api/advertencias').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it('filtra por tipo y por código', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    await crearAsistenciaConAdvertencia({ socio, tipo: 'escuelita', codigo: 'CUOTA_SOCIAL_IMPAGA' });
    await crearAsistenciaConAdvertencia({ socio, tipo: 'muro_libre', codigo: 'PASE_MENSUAL_IMPAGO' });

    const porTipo = await request(app).get('/api/advertencias?tipo=muro_libre').set('Authorization', `Bearer ${token}`);
    expect(porTipo.body.total).toBe(1);
    expect(porTipo.body.advertencias[0].tipo).toBe('muro_libre');

    const porCodigo = await request(app).get('/api/advertencias?codigo=CUOTA_SOCIAL_IMPAGA').set('Authorization', `Bearer ${token}`);
    expect(porCodigo.body.total).toBe(1);
    expect(porCodigo.body.advertencias[0].advertencias[0].codigo).toBe('CUOTA_SOCIAL_IMPAGA');
  });

  it('appcarc-backend#216: filtrar por código no trae los OTROS códigos del mismo check-in', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    // Un mismo check-in puede acumular varios códigos distintos (ver
    // checkinEscuelita.handler.js) — el filtro de Mongo solo exige que ALGUNO
    // matchee, no descarta los demás del array embebido.
    await Asistencia.create({
      clubId: 'CARC', tipo: 'escuelita', socioId: socio._id, nombre: socio.nombre, apellido: socio.apellido, esSocio: true, fecha: new Date(),
      advertencias: [
        { codigo: 'CUOTA_SOCIAL_IMPAGA', mensaje: 'x' },
        { codigo: 'LIMITE_SEMANAL', mensaje: 'y' },
      ],
      createdBy: 'test', updatedBy: 'test',
    });

    const res = await request(app).get('/api/advertencias?codigo=CUOTA_SOCIAL_IMPAGA').set('Authorization', `Bearer ${token}`);

    expect(res.body.total).toBe(1);
    expect(res.body.advertencias[0].advertencias).toHaveLength(1);
    expect(res.body.advertencias[0].advertencias[0].codigo).toBe('CUOTA_SOCIAL_IMPAGA');
  });

  it('rechaza un tipo o código inválido (400)', async () => {
    const { token } = await createAdminUser();

    const tipoInvalido = await request(app).get('/api/advertencias?tipo=natacion').set('Authorization', `Bearer ${token}`);
    expect(tipoInvalido.status).toBe(400);

    const codigoInvalido = await request(app).get('/api/advertencias?codigo=INVENTADO').set('Authorization', `Bearer ${token}`);
    expect(codigoInvalido.status).toBe(400);
  });

  it('no incluye asistencias fuera de la ventana de días', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    const haceCuarentaDias = new Date();
    haceCuarentaDias.setDate(haceCuarentaDias.getDate() - 40);
    await crearAsistenciaConAdvertencia({ socio, fecha: haceCuarentaDias });

    const res = await request(app).get('/api/advertencias?dias=30').set('Authorization', `Bearer ${token}`);
    expect(res.body.total).toBe(0);
  });

  it.each([
    ['0358-151234567', '549358151234567'],
    ['543581234567', '543581234567'],
    ['3581234567', '5493581234567'],
  ])('arma el waLink normalizando el teléfono %s', async (telefonoCrudo, esperado) => {
    const { token } = await createAdminUser();
    const socio = await createSocio({ telefono: telefonoCrudo });
    await crearAsistenciaConAdvertencia({ socio });

    const res = await request(app).get('/api/advertencias').set('Authorization', `Bearer ${token}`);
    expect(res.body.advertencias[0].waLink).toContain(`https://wa.me/${esperado}?text=`);
  });

  it('devuelve waLink null si el socio no tiene teléfono cargado', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio({ telefono: undefined });
    await crearAsistenciaConAdvertencia({ socio });

    const res = await request(app).get('/api/advertencias').set('Authorization', `Bearer ${token}`);
    expect(res.body.advertencias[0].waLink).toBeNull();
  });

  it('un rol con asistencias:read pero sin advertencias:read no puede ver el panel (403)', async () => {
    const { token } = await crearUsuarioConPermisos(['asistencias:read', 'asistencias:write']);

    const res = await request(app).get('/api/advertencias').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('un rol con advertencias:read (sin asistencias:read) sí puede ver el panel', async () => {
    const { token } = await crearUsuarioConPermisos(['advertencias:read']);
    const socio = await createSocio();
    await crearAsistenciaConAdvertencia({ socio });

    const res = await request(app).get('/api/advertencias').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it('incluye advertencias de morosidad abiertas junto con las de check-in', async () => {
    const { token } = await createAdminUser();
    // appcarc-backend#210 (agruparPorSocio, 969d77d): el resultado es una
    // fila por SOCIO, no una fila por advertencia — con un solo socio, el
    // check-in y la morosidad se fusionan en la misma fila (total pasaría a
    // ser 1, no 2). Se usan dos socios distintos para que esta prueba siga
    // verificando lo que dice su nombre (ambos tipos aparecen en el
    // resultado) sin pisarse con esa fusión, que tiene su propia cobertura.
    const socio = await createSocio();
    const otroSocio = await createSocio();
    await crearAsistenciaConAdvertencia({ socio });
    await Advertencia.create({
      clubId: 'CARC', socioId: otroSocio._id, codigo: 'MOROSIDAD_CUOTA_SOCIAL',
      mensaje: 'Debe 3 meses de cuota social', nombre: otroSocio.nombre, apellido: otroSocio.apellido,
      estado: 'abierta', detectadoEn: new Date(), ultimaRevision: new Date(),
    });

    const res = await request(app).get('/api/advertencias').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.advertencias.some((a) => a.tipo === 'morosidad')).toBe(true);
  });

  it('filtra solo morosidad con tipo=morosidad, ignorando "dias"', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    const haceUnAnio = new Date();
    haceUnAnio.setFullYear(haceUnAnio.getFullYear() - 1);
    await Advertencia.create({
      clubId: 'CARC', socioId: socio._id, codigo: 'MOROSIDAD_CUOTA_SOCIAL',
      mensaje: 'Debe 3 meses de cuota social', nombre: socio.nombre, apellido: socio.apellido,
      estado: 'abierta', detectadoEn: haceUnAnio, ultimaRevision: haceUnAnio,
    });

    const res = await request(app).get('/api/advertencias?tipo=morosidad&dias=7').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.advertencias[0].tipo).toBe('morosidad');
  });

  it('no incluye advertencias de morosidad ya resueltas', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    await Advertencia.create({
      clubId: 'CARC', socioId: socio._id, codigo: 'MOROSIDAD_CUOTA_SOCIAL',
      mensaje: 'Debe 3 meses de cuota social', nombre: socio.nombre, apellido: socio.apellido,
      estado: 'resuelta', detectadoEn: new Date(), ultimaRevision: new Date(), resueltoEn: new Date(),
    });

    const res = await request(app).get('/api/advertencias?tipo=morosidad').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });
});
