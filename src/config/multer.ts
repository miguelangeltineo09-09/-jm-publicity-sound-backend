// ==========================================
// Configuración de Multer (recepción de archivos multipart/form-data).
//
// Se usa memoryStorage (en vez de guardar en disco) porque el archivo no se
// queda en el servidor: solo se necesita el buffer en memoria el tiempo
// suficiente para reenviarlo a Cloudinary (ver upload.service.ts).
// ==========================================

import type { NextFunction, Request, Response } from "express";
import multer from "multer";

const storage = multer.memoryStorage();

// ==========================================
// Multer para los equipos (src/routes/equipo.routes.ts): recibe UN archivo de
// imagen O de video, el medio principal del equipo (ver Equipo.tipoMedia en
// prisma/schema.prisma). Reemplaza a la instancia anterior de solo imágenes
// (5 MB), que ya no sirve porque un equipo también puede ser un VIDEO.
//
// Cuál de los dos archivos corresponde (y que llegue exactamente uno) se
// valida más adelante, en equipo.service.ts, según el "tipoMedia" del equipo.
// ==========================================

// Un video pesa mucho más que una foto de catálogo: este es el tope de
// cualquier archivo que llegue (mismo valor que el de los videos de eventos).
const TAMANO_MAXIMO_MB = 50;

// Error propio para un archivo cuyo tipo no corresponde a su campo (ver el
// fileFilter de abajo): se distingue de los errores internos de multer para
// poder mostrar su mensaje tal cual.
class ArchivoNoPermitidoError extends Error {}

// "imagen" y "video" son los únicos campos de archivo válidos, con un
// archivo como máximo en cada uno (un archivo extra en el mismo campo, o en
// otro campo, lo rechaza multer con LIMIT_UNEXPECTED_FILE).
const recibirArchivosEquipo = multer({
  storage,
  // multer aplica UN solo tope de tamaño a todos los archivos, así que este
  // es el de los videos. El tope de 5 MB para las imágenes (el que ya tenían
  // los equipos) se aplica después, en equipo.service.ts, porque solo allí
  // se sabe cuál de los dos archivos es.
  limits: { fileSize: TAMANO_MAXIMO_MB * 1024 * 1024 },
  // El tipo de archivo aceptado depende del CAMPO por el que llegó: cualquier
  // otro tipo se rechaza antes de llegar al controlador.
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === "imagen" && !file.mimetype.startsWith("image/")) {
      cb(new ArchivoNoPermitidoError("El archivo del campo 'imagen' debe ser una imagen."));
      return;
    }
    if (file.fieldname === "video" && !file.mimetype.startsWith("video/")) {
      cb(new ArchivoNoPermitidoError("El archivo del campo 'video' debe ser un video."));
      return;
    }
    cb(null, true);
  },
}).fields([
  { name: "imagen", maxCount: 1 },
  { name: "video", maxCount: 1 },
]);

// Convierte un error de multer en el mensaje que se le muestra al cliente.
function mensajeDeErrorDeSubida(error: unknown): string {
  if (error instanceof ArchivoNoPermitidoError) {
    return error.message;
  }
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return `El archivo supera el tamaño máximo permitido (${TAMANO_MAXIMO_MB} MB).`;
    }
    if (error.code === "LIMIT_UNEXPECTED_FILE") {
      return "Archivo no permitido: envía un solo archivo, en el campo 'imagen' (equipo de tipo FOTO) o en el campo 'video' (equipo de tipo VIDEO).";
    }
  }
  return `No se pudo leer el archivo enviado: ${error instanceof Error ? error.message : "formato inválido"}.`;
}

/**
 * Middleware de las rutas POST /api/equipos y PUT /api/equipos/:id: recibe
 * el archivo de imagen o de video (multipart/form-data) y lo deja en
 * "req.files". Envuelve a multer para que sus errores (archivo demasiado
 * grande, campo inesperado, tipo de archivo incorrecto) lleguen al cliente
 * como un 400 con un mensaje claro en JSON, igual que el resto de errores de
 * validación de la API, en vez del 500 genérico de Express.
 *
 * Si la petición no es multipart (ej. un JSON sin archivos), multer no hace
 * nada y "req.files" queda sin definir.
 */
export function recibirMediaEquipo(req: Request, res: Response, next: NextFunction): void {
  recibirArchivosEquipo(req, res, (error?: unknown) => {
    if (error === undefined || error === null) {
      next();
      return;
    }
    res.status(400).json({ error: mensajeDeErrorDeSubida(error) });
  });
}

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
