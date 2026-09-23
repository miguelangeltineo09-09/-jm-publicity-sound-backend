// ==========================================
// Servicio de subida de imágenes a Cloudinary.
//
// Flujo completo:
// 1. El archivo llega al controlador ya como buffer en memoria (gracias a
//    multer con memoryStorage, ver src/config/multer.ts).
// 2. Este servicio abre un "upload_stream" de Cloudinary (la forma de subir
//    un buffer sin pasar por el disco) y le escribe el buffer.
// 3. Cloudinary devuelve la URL segura (https) de la imagen ya alojada,
//    que es lo que se guarda en Equipo.imagenUrl.
// ==========================================

import cloudinary from "../config/cloudinary";

// Carpeta de Cloudinary donde se organizan las imágenes del catálogo,
// separadas del resto de recursos que pueda tener la cuenta.
const CARPETA_EQUIPOS = "jm-publicity-sound/equipos";

/**
 * Sube un buffer de imagen a Cloudinary y devuelve su URL segura (https).
 */
export function subirImagen(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const streamUpload = cloudinary.uploader.upload_stream(
      { folder: CARPETA_EQUIPOS },
      (error, result) => {
        if (error || !result) {
          reject(error ?? new Error("Cloudinary no devolvió resultado."));
          return;
        }
        resolve(result.secure_url);
      }
    );

    // upload_stream devuelve un stream escribible: al terminarlo con el
    // buffer completo, Cloudinary recibe la imagen sin pasar por disco.
    streamUpload.end(buffer);
  });
}
