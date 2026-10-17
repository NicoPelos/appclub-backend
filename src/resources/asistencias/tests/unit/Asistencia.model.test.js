import { describe, expect, it } from 'vitest';
import Asistencia from '../../models/Asistencia.js';

// Red de seguridad a nivel de modelo (appcarc-backend#167) — los handlers ya
// validan explícito antes de llegar acá (ver checkinEscuelita.handler.js,
// registrarMuroLibre.service.js, registrarAsistenciaEscuelita.service.js,
// updateMuroLibre.handler.js, updateAsistencia.handler.js), esto cubre
// cualquier código que se olvide de hacerlo.
const base = {
  clubId: 'club1', tipo: 'muro_libre', nombre: 'Juan', esSocio: true,
  createdBy: 'x', updatedBy: 'x',
};

describe('Asistencia (modelo) — fecha no puede ser futura', () => {
  it('rechaza una fecha futura', async () => {
    const doc = new Asistencia({ ...base, fecha: new Date('2099-01-01T12:00:00.000Z') });
    await expect(doc.validate()).rejects.toMatchObject({
      errors: { fecha: expect.objectContaining({ message: 'La fecha de la asistencia no puede ser futura' }) },
    });
  });

  it('acepta una fecha pasada', async () => {
    const doc = new Asistencia({ ...base, fecha: new Date('2020-01-01T12:00:00.000Z') });
    await expect(doc.validate()).resolves.toBeUndefined();
  });

  it('acepta el default (ahora) cuando no se pasa fecha', async () => {
    const doc = new Asistencia({ ...base });
    await expect(doc.validate()).resolves.toBeUndefined();
  });
});
