import Club from '../../clubs/models/Club.js';

export const createClubHandler = async (req, res) => {
  try {
    const { nombre, slug, logoUrl, contacto, plan, modulos, integraciones } = req.body;

    if (!nombre || !slug) {
      return res.status(400).json({ message: 'nombre y slug son requeridos' });
    }

    // Ojo: NO normalizar el slug acá (ver el comentario grande en Club.js) —
    // el resto del sistema (User.clubId, Socio.clubId, Rol.clubId, JWT,
    // getClubs.handler.js contando por club.slug tal cual) asume slug
    // verbatim, sin forzar mayúscula/minúscula; ya rompió en producción una
    // vez (#75) por esta misma razón. El chequeo de duplicado tiene que
    // comparar exactamente lo mismo que se va a guardar.
    const existe = await Club.findOne({ slug });
    if (existe) return res.status(409).json({ message: `Ya existe un club con slug '${slug}'` });

    const club = await Club.create({ nombre, slug, logoUrl, contacto, plan, modulos, integraciones });
    res.status(201).json(club);
  } catch (error) {
    console.error('Error creando club:', error);
    res.status(500).json({ message: 'Error al crear club' });
  }
};
