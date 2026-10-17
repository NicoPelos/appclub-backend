import multer from 'multer';

// appcarc-backend#263: 3 configs de multer casi idénticas (fotos de socio,
// comprobantes de movimiento, fotos de ítem de inventario) — misma
// storage en memoria, mismo fileFilter de solo-imágenes, mismo manejo de
// LIMIT_FILE_SIZE. Lo único que cambiaba entre las tres era el tamaño
// máximo (20MB, 20MB, 15MB) y el mensaje exacto del error, así que queda
// como parámetro.
export const createUploadImagen = (maxSizeMb = 20) => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxSizeMb * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.startsWith('image/')) {
        return cb(new Error('Solo se permiten imágenes'));
      }
      cb(null, true);
    },
  });

  // multer llama a next(err) cuando se excede el límite de tamaño, antes de
  // llegar al handler — sin esto, Express devuelve una página HTML de error
  // que rompe el parseo de JSON del lado del cliente (la app nunca se entera
  // del mensaje real, solo ve un error de parseo genérico).
  const handleUploadError = (err, req, res, next) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: `La imagen supera el tamaño máximo permitido (${maxSizeMb}MB).` });
    }
    if (err) {
      return res.status(400).json({ message: err.message || 'Error al procesar la imagen' });
    }
    next();
  };

  return { upload, handleUploadError };
};

export default createUploadImagen;
