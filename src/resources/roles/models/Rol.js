import mongoose from 'mongoose';
import { TODOS_LOS_PERMISOS } from '../../../constants/permisos.js';

const rolSchema = new mongoose.Schema({
  clubId:    { type: String, required: true, index: true },
  nombre:    { type: String, required: true },
  // Identidad estable del rol para el código (ej. "es el rol de socio"),
  // separada del nombre visible/editable. Se genera una sola vez al crear
  // el rol y no se vuelve a tocar — ver src/resources/roles/services/slug.service.js.
  slug:      { type: String, required: true },
  permisos:  { type: [String], enum: TODOS_LOS_PERMISOS, default: [] },
  active:    { type: Boolean, default: true },
}, { timestamps: true, collection: 'roles' });

rolSchema.index({ clubId: 1, nombre: 1 }, { unique: true, partialFilterExpression: { active: true } });
rolSchema.index({ clubId: 1, slug: 1 }, { unique: true, partialFilterExpression: { active: true } });

const Rol = mongoose.model('Rol', rolSchema);

export default Rol;
