import mongoose from 'mongoose';

const clubSchema = new mongoose.Schema({
  nombre:   { type: String, required: true },
  // Ojo: NO usar lowercase:true acá — el resto del sistema entero (User.clubId,
  // Socio.clubId, Rol.clubId, req.user.clubId del JWT, etc.) es un string
  // suelto sin normalizar, y para CARC específicamente vale "CARC" en
  // mayúscula. Un lowercase:true en el schema hace que Mongoose transforme
  // también el FILTRO de las queries (no solo lo que se guarda) — eso rompió
  // en producción tanto /api/export/sheets y asignarSocioNumber (ver #75)
  // como, distinto, varios endpoints de appcarc-superadmin que comparan
  // club.slug contra esas otras colecciones (getSuperRoles, getUsers,
  // getClubs, config de Instagram/MercadoPago) — esos quedaron rotos cuando
  // el fix de #75 forzó el slug a minúscula. La normalización correcta es
  // "todo consistente con la convención ya establecida" (mayúscula), no al
  // revés.
  slug:     { type: String, required: true, unique: true, trim: true },
  logoUrl:  { type: String, default: null },
  contacto: {
    email:     { type: String, default: null },
    telefono:  { type: String, default: null },
    direccion: { type: String, default: null },
  },
  plan: { type: String, enum: ['free', 'basico', 'premium'], default: 'basico' },
  modulos: {
    escuelita:    { type: Boolean, default: true },
    muroLibre:    { type: Boolean, default: true },
    exportSheets: { type: Boolean, default: false },
    novedades:    { type: Boolean, default: true },
  },
  integraciones: {
    sheets: {
      spreadsheetId: { type: String, default: null },
    },
  },
  active:       { type: Boolean, default: true },
  suspendidoAt: { type: Date, default: null },
  // Contador atómico para asignar el próximo socioNumber — ver
  // src/resources/socios/services/socioData.service.js#asignarSocioNumber.
  ultimoSocioNumber: { type: Number, default: 0 },
}, { timestamps: true });

const Club = mongoose.model('Club', clubSchema);
export default Club;
