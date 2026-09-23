// ==========================================
// Configuración de Multer (recepción de archivos multipart/form-data).
//
// Se usa memoryStorage (en vez de guardar en disco) porque el archivo no se
// queda en el servidor: solo se necesita el buffer en memoria el tiempo
// suficiente para reenviarlo a Cloudinary (ver upload.service.ts).
// ==========================================

import multer from "multer";

const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  // Límite de tamaño para evitar que alguien suba archivos enormes por error o abuso.
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  // Solo se aceptan imágenes: cualquier otro tipo de archivo se rechaza antes
  // de llegar al controlador.
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("El archivo debe ser una imagen."));
      return;
    }
    cb(null, true);
  },
});

// ==========================================
// Multer para las publicaciones de eventos (src/routes/publicacion.routes.ts).
// Es una instancia SEPARADA de "upload" (no se reutiliza ni se modifica la
// de arriba) porque las publicaciones tienen necesidades distintas a la
// imagen de un equipo:
// - Aceptan VIDEO además de imagen (la de arriba solo permite "image/*").
// - Un video corto pesa mucho más que una foto de catálogo: 5 MB se queda
//   corto casi de inmediato, así que el límite es mayor.
// - Puede llegar más de un archivo en la misma petición (el álbum de
//   fotos), así que además del límite de tamaño hace falta un límite de
//   cantidad de archivos.
// ==========================================
export const uploadEventos = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB: suficiente para un video corto de evento.
    files: 20, // tope razonable de fotos por álbum.
  },
  // Acepta imagen O video (a diferencia de "upload", que solo acepta
  // imagen): qué combinación es válida para cada publicación (un solo
  // video, o una o más imágenes) se valida más adelante, en
  // publicacion.service.ts, según el campo "tipo" que mandó el admin.
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/") && !file.mimetype.startsWith("video/")) {
      cb(new Error("El archivo debe ser una imagen o un video."));
      return;
    }
    cb(null, true);
  },
});
