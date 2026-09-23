// ==========================================
// Servicio de Publicaciones de eventos realizados.
//
// Igual que factura.service.ts/email.service.ts: concentra la lógica de
// negocio (validar el equipo, subir/borrar archivos en Cloudinary, crear
// los registros en la base de datos) y señala los fallos de negocio
// lanzando errores propios, para que publicacion.controller.ts los
// traduzca al código HTTP correcto con "instanceof", sin acoplar esta
// lógica a Express.
// ==========================================

import cloudinary from "../config/cloudinary";
import { prisma } from "../config/prisma";
import { TipoPublicacion } from "../generated/prisma/enums";
import type { PublicacionEventoModel } from "../generated/prisma/models";

// Carpeta de Cloudinary donde se organizan fotos y videos de eventos,
// separada de "jm-publicity-sound/equipos" (ver upload.service.ts): son
// recursos de naturaleza distinta (contenido de marketing/portafolio, no
// fichas de producto del catálogo) y crecen a un ritmo distinto.
const CARPETA_EVENTOS = "jm-publicity-sound/eventos";

// --- Errores de negocio propios ---
export class EquipoNoEncontradoError extends Error {}
export class PublicacionNoEncontradaError extends Error {}

// ==========================================
// Subida y borrado de archivos en Cloudinary.
// ==========================================

// Sube un buffer (imagen o video) a la carpeta de eventos. "resourceType"
// le dice a Cloudinary cómo procesar el archivo: "image" para fotos,
// "video" para clips — a diferencia de subirImagen() en upload.service.ts,
// que no lo necesita porque ahí SIEMPRE es una imagen.
function subirArchivoEvento(buffer: Buffer, resourceType: "image" | "video"): Promise<string> {
  return new Promise((resolve, reject) => {
    const streamUpload = cloudinary.uploader.upload_stream(
      { folder: CARPETA_EVENTOS, resource_type: resourceType },
      (error, result) => {
        if (error || !result) {
          reject(error ?? new Error("Cloudinary no devolvió resultado."));
          return;
        }
        resolve(result.secure_url);
      }
    );

    streamUpload.end(buffer);
  });
}

// Extrae el "public_id" (la carpeta más el nombre, sin extensión) de una
// URL segura de Cloudinary. Hace falta para poder borrar el archivo más
// adelante: la API de borrado de Cloudinary no acepta una URL, solo un
// public_id + resource_type. Como esta app no aplica transformaciones al
// subir (ver subirArchivoEvento), la URL siempre tiene la forma
// ".../upload/v<version>/<carpeta>/<id>.<extension>", así que alcanza con
// quitar todo antes de "/upload/", el segmento de versión, y la extensión.
function extraerPublicId(url: string): string {
  const despuesDeUpload = url.split("/upload/")[1] ?? url;
  const sinVersion = despuesDeUpload.replace(/^v\d+\//, "");
  return sinVersion.replace(/\.[^./]+$/, "");
}

// Borra un archivo ya subido (imagen o video) de Cloudinary a partir de su URL.
function eliminarArchivoEvento(url: string, resourceType: "image" | "video"): Promise<void> {
  const publicId = extraerPublicId(url);
  return cloudinary.uploader.destroy(publicId, { resource_type: resourceType }).then(() => undefined);
}

// Deriva la miniatura de un video ya subido cambiando su extensión a
// ".jpg": Cloudinary sirve automáticamente un frame del video como imagen
// cuando se pide esa misma URL con formato de imagen, así que no hace
// falta subir un archivo de miniatura aparte para tener un thumbnailUrl.
function derivarThumbnailDeVideo(videoUrl: string): string {
  return videoUrl.replace(/\.[^./]+$/, ".jpg");
}

// Confirma que el equipo protagonista de la publicación exista antes de
// gastar tiempo/ancho de banda subiendo archivos a Cloudinary.
async function validarEquipoExiste(equipoId: number): Promise<void> {
  const equipo = await prisma.equipo.findUnique({ where: { id: equipoId } });
  if (!equipo) {
    throw new EquipoNoEncontradoError();
  }
}

// ==========================================
// Creación de publicaciones.
// ==========================================

interface DatosPublicacionComunes {
  titulo: string;
  comentario?: string;
  equipoId: number;
  destacado?: boolean;
}

/**
 * Crea una publicación de tipo VIDEO: sube el único archivo de video a
 * Cloudinary y guarda el registro con su videoUrl (y un thumbnailUrl
 * derivado automáticamente del propio video, ver derivarThumbnailDeVideo).
 */
export async function crearPublicacionVideo(
  datos: DatosPublicacionComunes & { archivoVideo: Buffer }
): Promise<PublicacionEventoModel> {
  await validarEquipoExiste(datos.equipoId);

  const videoUrl = await subirArchivoEvento(datos.archivoVideo, "video");

  return prisma.publicacionEvento.create({
    data: {
      titulo: datos.titulo,
      comentario: datos.comentario,
      tipo: TipoPublicacion.VIDEO,
      videoUrl,
      thumbnailUrl: derivarThumbnailDeVideo(videoUrl),
      equipoId: datos.equipoId,
      destacado: datos.destacado ?? false,
    },
  });
}

/**
 * Crea una publicación de tipo FOTO: sube todas las imágenes a Cloudinary
 * y crea el registro de PublicacionEvento junto con sus ImagenPublicacion
 * asociadas, respetando el orden en que llegaron los archivos.
 */
export async function crearPublicacionFoto(
  datos: DatosPublicacionComunes & { archivosImagenes: Buffer[] }
): Promise<PublicacionEventoModel> {
  await validarEquipoExiste(datos.equipoId);

  // Se suben todas las imágenes en paralelo (cada subida es independiente
  // de las demás); Promise.all devuelve los resultados en el MISMO orden
  // que el array de entrada sin importar en qué orden terminen de subir,
  // así que "indice" abajo sigue representando la posición real en el
  // carrusel tal como se recibieron los archivos.
  const urls = await Promise.all(datos.archivosImagenes.map((buffer) => subirArchivoEvento(buffer, "image")));

  return prisma.publicacionEvento.create({
    data: {
      titulo: datos.titulo,
      comentario: datos.comentario,
      tipo: TipoPublicacion.FOTO,
      equipoId: datos.equipoId,
      destacado: datos.destacado ?? false,
      imagenes: {
        create: urls.map((imagenUrl, orden) => ({ imagenUrl, orden })),
      },
    },
    include: { imagenes: { orderBy: { orden: "asc" } } },
  });
}

// ==========================================
// Eliminación.
// ==========================================

/**
 * Elimina una publicación junto con sus archivos reales en Cloudinary (el
 * video, o todas las imágenes del álbum).
 *
 * Orden importante: primero se borran los archivos en Cloudinary y RECIÉN
 * DESPUÉS el registro en la base de datos. Si el borrado en Cloudinary
 * fallara, es mejor que el registro siga existiendo (se puede reintentar)
 * que borrar la fila y quedarse con archivos huérfanos en Cloudinary sin
 * ninguna referencia desde la base de datos.
 */
export async function eliminarPublicacion(id: number): Promise<void> {
  const publicacion = await prisma.publicacionEvento.findUnique({
    where: { id },
    include: { imagenes: true },
  });

  if (!publicacion) {
    throw new PublicacionNoEncontradaError();
  }

  if (publicacion.tipo === TipoPublicacion.VIDEO) {
    if (publicacion.videoUrl) {
      await eliminarArchivoEvento(publicacion.videoUrl, "video");
    }
  } else {
    await Promise.all(publicacion.imagenes.map((imagen) => eliminarArchivoEvento(imagen.imagenUrl, "image")));
  }

  // Las filas de ImagenPublicacion se borran solas por la cascada definida
  // en prisma/schema.prisma (onDelete: Cascade) — no hace falta borrarlas
  // a mano acá.
  await prisma.publicacionEvento.delete({ where: { id } });
}
