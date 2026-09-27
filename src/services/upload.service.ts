// ==========================================
// Servicio de subida de imágenes y videos de equipos a Cloudinary.
//
// Flujo completo:
// 1. El archivo llega al controlador ya como buffer en memoria (gracias a
//    multer con memoryStorage, ver src/config/multer.ts).
// 2. Este servicio abre un "upload_stream" de Cloudinary (la forma de subir
//    un buffer sin pasar por el disco) y le escribe el buffer.
// 3. Cloudinary devuelve la URL segura (https) del archivo ya alojado, que
//    es lo que se guarda en Equipo.imagenUrl (foto) o Equipo.videoUrl (video).
//
// Quién lo usa: equipo.service.ts, que decide cuándo subir y cuándo borrar
// (ej. al cambiar un equipo de FOTO a VIDEO).
// ==========================================

import cloudinary from "../config/cloudinary";

// Carpeta de Cloudinary donde se organizan las imágenes del catálogo,
// separadas del resto de recursos que pueda tener la cuenta.
const CARPETA_EQUIPOS = "jm-publicity-sound/equipos";

// Carpeta donde se organizan los VIDEOS de los equipos. Separada de la de
// imágenes de arriba (son archivos de otro tipo y mucho más pesados, así se
// pueden ubicar y limpiar por separado) y de la de videos de eventos
// ("jm-publicity-sound/eventos", ver publicacion.service.ts): un video de
// catálogo no es contenido de portafolio de un evento.
const CARPETA_EQUIPOS_VIDEO = "jm-publicity-sound/equipos-video";

// Solo se permite BORRAR archivos cuyo public_id empiece con alguna de estas
// carpetas (ver eliminarArchivoEquipo): así, aunque una URL guardada en la
// base de datos apuntara a otro lugar, esta app nunca borra algo que no
// subió ella misma como archivo de equipo.
const PREFIJOS_CARPETAS_EQUIPOS = [`${CARPETA_EQUIPOS}/`, `${CARPETA_EQUIPOS_VIDEO}/`];

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

// Deriva la miniatura de un video ya subido cambiando su extensión a
// ".jpg": Cloudinary sirve automáticamente un fotograma del video como
// imagen cuando se pide esa misma URL con formato de imagen, así que no hace
// falta subir un archivo de miniatura aparte. Es la misma técnica que usan
// las publicaciones de tipo VIDEO (ver derivarThumbnailDeVideo en
// publicacion.service.ts).
function derivarThumbnailDeVideo(videoUrl: string): string {
  return videoUrl.replace(/\.[^./]+$/, ".jpg");
}

/**
 * Sube un buffer de video a Cloudinary y devuelve su URL segura (https) junto
 * con la URL de su miniatura (un fotograma del propio video, ver
 * derivarThumbnailDeVideo).
 *
 * Misma técnica que los videos de las publicaciones (ver
 * subirArchivoEvento en publicacion.service.ts): "resource_type: video" le
 * dice a Cloudinary que procese el archivo como video (con el valor por
 * defecto, "image", rechazaría el archivo). Solo cambia la carpeta de destino.
 */
export function subirVideo(buffer: Buffer): Promise<{ videoUrl: string; thumbnailUrl: string }> {
  return new Promise((resolve, reject) => {
    const streamUpload = cloudinary.uploader.upload_stream(
      { folder: CARPETA_EQUIPOS_VIDEO, resource_type: "video" },
      (error, result) => {
        if (error || !result) {
          reject(error ?? new Error("Cloudinary no devolvió resultado."));
          return;
        }
        resolve({ videoUrl: result.secure_url, thumbnailUrl: derivarThumbnailDeVideo(result.secure_url) });
      }
    );

    streamUpload.end(buffer);
  });
}

// Extrae el "public_id" (la carpeta más el nombre, sin extensión) de una URL
// segura de Cloudinary, porque la API de borrado no acepta una URL sino un
// public_id + resource_type. Como esta app no aplica transformaciones al
// subir, la URL siempre tiene la forma
// ".../upload/v<version>/<carpeta>/<id>.<extension>": alcanza con quitar lo
// que hay antes de "/upload/", el segmento de versión y la extensión.
// Devuelve null si la URL no es de una subida de Cloudinary (no tiene
// "/upload/"), para no intentar borrar nada a ciegas.
function extraerPublicId(url: string): string | null {
  const despuesDeUpload = url.split("/upload/")[1];
  if (despuesDeUpload === undefined) {
    return null;
  }
  return despuesDeUpload.replace(/^v\d+\//, "").replace(/\.[^./]+$/, "");
}

/**
 * Borra de Cloudinary un archivo de equipo (imagen o video) a partir de su URL.
 *
 * NUNCA lanza errores: se usa para limpiar archivos que ya no hacen falta
 * (el medio reemplazado de un equipo, o un archivo recién subido cuando algo
 * falló después), donde el resultado principal de la operación ya está
 * decidido. Que Cloudinary falle al borrar deja, como mucho, un archivo
 * huérfano; no debe convertir en error una operación que sí salió bien. Los
 * fallos se registran en consola.
 *
 * Solo borra si el archivo está en una carpeta de equipos (ver
 * PREFIJOS_CARPETAS_EQUIPOS). "invalidate" además pide a Cloudinary que
 * descarte las copias que ya tenga en su caché (CDN), para que el archivo
 * borrado deje de servirse.
 */
export async function eliminarArchivoEquipo(url: string, tipo: "image" | "video"): Promise<void> {
  const publicId = extraerPublicId(url);
  if (publicId === null || !PREFIJOS_CARPETAS_EQUIPOS.some((prefijo) => publicId.startsWith(prefijo))) {
    return;
  }

  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: tipo, invalidate: true });
  } catch (error) {
    console.error(`No se pudo borrar el archivo '${publicId}' de Cloudinary:`, error);
  }
}
