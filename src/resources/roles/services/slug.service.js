import Rol from '../models/Rol.js';

// admin, secretaria, profesor, palestrero, socio → mismo slug de siempre.
// "Profesor Senior" → "profesor-senior". Sin diacríticos, sin repetir guiones.
export const slugify = (texto) => (
  String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
);

// El slug es la identidad estable del rol para el código (ej. "es el rol de
// socio") — el nombre es solo la etiqueta editable que ve el humano. Si el
// slugify básico ya existe en el club (ej. dos roles que dan "instructor"),
// se desambigua con un sufijo numérico en vez de fallar.
export const generarSlugUnico = async ({ clubId, nombre }) => {
  const base = slugify(nombre) || 'rol';
  let candidato = base;
  let sufijo = 2;

  while (true) {
    const filter = { clubId, slug: candidato, active: true };
    const existe = await Rol.findOne(filter);
    if (!existe) return candidato;
    candidato = `${base}-${sufijo}`;
    sufijo += 1;
  }
};
