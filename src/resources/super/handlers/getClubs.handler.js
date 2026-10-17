import Club from '../../clubs/models/Club.js';
import User from '../../usuarios/models/User.js';
import Socio from '../../socios/models/Socio.js';

export const getClubsHandler = async (req, res) => {
  try {
    const clubs = await Club.find().sort({ nombre: 1 }).lean();

    const withMetrics = await Promise.all(
      clubs.map(async (club) => {
        const [userCount, socioCount] = await Promise.all([
          User.countDocuments({ clubId: club.slug, active: true }),
          Socio.countDocuments({ clubId: club.slug, active: true }),
        ]);
        return { ...club, userCount, socioCount };
      }),
    );

    res.status(200).json(withMetrics);
  } catch (error) {
    console.error('Error obteniendo clubs:', error);
    res.status(500).json({ message: 'Error al obtener clubs' });
  }
};
