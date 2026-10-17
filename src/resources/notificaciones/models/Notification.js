import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  clubId: {
    type: String,
    required: true,
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  // A qué perfil (socio) corresponde la notificación — puede ser el propio
  // socio de userId, o el de un hijo vinculado si userId es su tutor. null
  // para notificaciones que no son sobre un socio puntual (ej. avisos
  // generales del club a todo el staff). Sirve para mostrar el contador de
  // no leídas por perfil en el selector de "como quién entrás".
  socioId: {
    type: String,
    default: null,
    index: true,
  },
  title: {
    type: String,
    required: true,
  },
  body: {
    type: String,
    default: '',
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  read: {
    type: Boolean,
    default: false,
    index: true,
  },
}, {
  timestamps: true,
});

notificationSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('Notification', notificationSchema);
