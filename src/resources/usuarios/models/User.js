import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  mustChangePassword: { type: Boolean, default: false },
  passwordChangedAt: { type: Date },
  googleId: { type: String, default: null },
  nombre: String,
  // Referencia real al Rol (ver appcarc-backend#24) — antes era [String] con
  // el nombre del rol, lo que rompía en silencio si un rol se renombraba o
  // borraba. Sin default: el rol correcto depende del club, no hay uno
  // universal — quien cree un User tiene que resolverlo explícitamente
  // (ver src/resources/roles/services/resolverRoles.service.js).
  roles: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Rol' }], default: [] },
  clubId: { type: String, required: true },
  socioId: { type: String, unique: true, sparse: true },
  expoPushToken: { type: String, default: null },
  active: { type: Boolean, default: true },
}, { timestamps: true });

// Un email puede existir en distintos clubs (multi-tenant)
userSchema.index({ email: 1, clubId: 1 }, { unique: true });

const User = mongoose.model('User', userSchema);

export default User;