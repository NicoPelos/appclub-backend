import Club from '../../clubs/models/Club.js';

export const updateClubHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, logoUrl, contacto, plan, modulos, integraciones } = req.body ?? {};

    const esObjetoPlano = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    if (modulos !== undefined && !esObjetoPlano(modulos)) return res.status(400).json({ message: 'modulos debe ser un objeto' });
    if (integraciones !== undefined && !esObjetoPlano(integraciones)) return res.status(400).json({ message: 'integraciones debe ser un objeto' });

    // Cada módulo/integración se escribe por separado (modulos.x, integraciones.x):
    // mandar el objeto entero pisaba los demás flags y el spreadsheetId
    // (appcarc-backend#238).
    const set = {};
    for (const [campo, valor] of Object.entries({ nombre, logoUrl, contacto, plan })) {
      if (valor !== undefined) set[campo] = valor;
    }
    for (const [grupo, valores] of Object.entries({ modulos, integraciones })) {
      if (valores === undefined) continue;
      for (const [clave, valor] of Object.entries(valores)) set[`${grupo}.${clave}`] = valor;
    }

    const club = Object.keys(set).length
      ? await Club.findByIdAndUpdate(id, { $set: set }, { new: true, runValidators: true })
      : await Club.findById(id);

    if (!club) return res.status(404).json({ message: 'Club no encontrado' });
    res.status(200).json(club);
  } catch (error) {
    console.error('Error actualizando club:', error);
    res.status(500).json({ message: 'Error al actualizar club' });
  }
};
