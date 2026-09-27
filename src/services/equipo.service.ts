// ==========================================
// Servicio de Equipos.
//
// Igual que factura.service.ts y publicacion.service.ts: concentra la lógica
// de negocio de crear y editar equipos cuando hay archivos de por medio
// (validar, subir y borrar en Cloudinary, guardar en la base de datos),
// mientras que equipo.controller.ts solo traduce HTTP <-> estas funciones.
// Los fallos de negocio se señalan lanzando errores propios, que el
// controlador distingue con "instanceof" para elegir el código HTTP (400/404)
// sin acoplar esta lógica a Express.
//
// REGLA CENTRAL: un equipo tiene UN solo medio principal, una FOTO o un VIDEO
// (ver Equipo.tipoMedia en prisma/schema.prisma), y sus campos de medio
// (imagenUrl, videoUrl, thumbnailUrl) SIEMPRE se escriben juntos: el del tipo
// elegido con su valor y los demás en null. Así, al cambiar de tipo, el medio
// anterior se reemplaza por completo y nunca quedan datos viejos de los dos
// tipos a la vez.
// ==========================================

import { prisma } from "../config/prisma";
import { Prisma } from "../generated/prisma/client";
import { TipoMedia } from "../generated/prisma/enums";
import type { EquipoModel } from "../generated/prisma/models";
import { eliminarArchivoEquipo, subirImagen, subirVideo } from "./upload.service";

// --- Errores de negocio propios ---
export class EquipoNoEncontradoError extends Error {}
// Los archivos recibidos no cumplen las reglas del medio del equipo (falta el
// archivo, llegaron los dos, no corresponde al tipoMedia, etc.). Su mensaje ya
// está redactado para mostrárselo al cliente: el controlador lo devuelve tal
// cual en un 400.
export class MediaInvalidoError extends Error {}

// Tope de tamaño de una IMAGEN de equipo: el que ya tenían las fotos antes de
// que existieran los videos. multer aplica un solo tope a todos los archivos
// (el de los videos, ver src/config/multer.ts), así que el de las imágenes se
// comprueba aquí, donde ya se sabe cuál de los dos archivos llegó.
const TAMANO_MAXIMO_IMAGEN_BYTES = 5 * 1024 * 1024;

// Archivos de medio recibidos en la petición, ya como buffers en memoria (el
// controlador los saca de "req.files"): a lo sumo uno de cada campo.
export interface ArchivosMedia {
  imagen?: Buffer;
  video?: Buffer;
}

// Datos de texto para crear un equipo (ya validados por el controlador).
// "tipoMedia" es opcional: si no se manda, el equipo se crea como FOTO.
export interface DatosEquipoNuevo {
  nombre: string;
  descripcion: string;
  precio: string;
  categoriaId: number;
  disponibleParaAlquiler?: boolean;
  tipoMedia?: TipoMedia;
}

// Datos de texto para editar un equipo: todos opcionales (edición parcial,
// solo se toca lo que llegó).
export interface DatosEquipoEditados {
  nombre?: string;
  descripcion?: string;
  precio?: string;
  categoriaId?: number;
  disponibleParaAlquiler?: boolean;
  tipoMedia?: TipoMedia;
}

// Los tres campos de medio de un equipo, siempre completos (ver la REGLA
// CENTRAL del encabezado): los del tipo que no se eligió van en null.
interface CamposMedio {
  tipoMedia: TipoMedia;
  imagenUrl: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
}

// ==========================================
// Validación y subida del medio.
// ==========================================

// Mensaje cuando falta el archivo que el tipo del equipo necesita.
function mensajeArchivoObligatorio(tipoMedia: TipoMedia): string {
  return tipoMedia === TipoMedia.VIDEO
    ? "Un equipo de tipo VIDEO debe incluir un video en el campo 'video'."
    : "Un equipo de tipo FOTO debe incluir una imagen en el campo 'imagen'.";
}

// Comprueba que los archivos recibidos sean coherentes con el tipo de medio
// indicado y devuelve el archivo que corresponde a ese tipo (o undefined si
// no llegó ninguno). Lanza MediaInvalidoError si:
//  - llegaron una imagen Y un video a la vez;
//  - llegó un archivo que no es del tipo del equipo (ej. un video en un
//    equipo FOTO);
//  - el archivo está vacío, o es una imagen de más de 5 MB.
// Que el archivo sea OBLIGATORIO (falta = error) NO se decide aquí: depende
// de si se está creando el equipo o editándolo (ver crearEquipo y
// actualizarEquipo).
function validarArchivosDeMedio(tipoMedia: TipoMedia, archivos: ArchivosMedia): Buffer | undefined {
  if (archivos.imagen !== undefined && archivos.video !== undefined) {
    throw new MediaInvalidoError(
      "No se puede enviar una imagen y un video a la vez: envía solo uno, el que corresponda al 'tipoMedia' del equipo."
    );
  }

  const esVideo = tipoMedia === TipoMedia.VIDEO;
  const campoCorrecto = esVideo ? "video" : "imagen";
  const campoIncorrecto = esVideo ? "imagen" : "video";

  // Ej.: un equipo FOTO que recibe un archivo en "video". No se adivina qué
  // quiso el cliente (cambiar el equipo a VIDEO borraría su foto): se le
  // pide que lo indique explícitamente con tipoMedia.
  if (archivos[campoIncorrecto] !== undefined) {
    const tipoOpuesto = esVideo ? TipoMedia.FOTO : TipoMedia.VIDEO;
    throw new MediaInvalidoError(
      `Un equipo de tipo ${tipoMedia} se guarda con ${esVideo ? "un video" : "una imagen"} (campo '${campoCorrecto}'), no con el campo '${campoIncorrecto}'. Si quieres que el equipo sea de tipo ${tipoOpuesto}, envía tipoMedia=${tipoOpuesto} junto con ese archivo.`
    );
  }

  const archivo = archivos[campoCorrecto];
  if (archivo === undefined) {
    return undefined;
  }
  if (archivo.length === 0) {
    throw new MediaInvalidoError(`El archivo del campo '${campoCorrecto}' está vacío.`);
  }
  if (!esVideo && archivo.length > TAMANO_MAXIMO_IMAGEN_BYTES) {
    throw new MediaInvalidoError("La imagen supera el tamaño máximo permitido (5 MB).");
  }

  return archivo;
}

// Sube el archivo a Cloudinary según el tipo y devuelve los tres campos de
// medio ya completos: el del tipo elegido con su URL y los demás en null.
async function subirMedio(tipoMedia: TipoMedia, archivo: Buffer): Promise<CamposMedio> {
  if (tipoMedia === TipoMedia.VIDEO) {
    const { videoUrl, thumbnailUrl } = await subirVideo(archivo);
    return { tipoMedia, imagenUrl: null, videoUrl, thumbnailUrl };
  }

  const imagenUrl = await subirImagen(archivo);
  return { tipoMedia, imagenUrl, videoUrl: null, thumbnailUrl: null };
}

// Borra de Cloudinary los archivos de un medio (la imagen y/o el video, los
// que existan). La miniatura no se borra aparte: no es un archivo propio,
// se deriva del video (ver subirVideo en upload.service.ts) y desaparece con
// él. Nunca lanza errores (ver eliminarArchivoEquipo).
async function eliminarArchivosDeMedio(medio: { imagenUrl: string | null; videoUrl: string | null }): Promise<void> {
  if (medio.imagenUrl) {
    await eliminarArchivoEquipo(medio.imagenUrl, "image");
  }
  if (medio.videoUrl) {
    await eliminarArchivoEquipo(medio.videoUrl, "video");
  }
}

// ==========================================
// Creación y edición.
// ==========================================

/**
 * Crea un equipo nuevo con su medio principal.
 *
 * Todo equipo nuevo necesita su medio: según "tipoMedia" (FOTO por defecto)
 * debe llegar exactamente un archivo, la imagen (FOTO) o el video (VIDEO).
 * Se valida ANTES de subir nada a Cloudinary, para no gastar ancho de banda
 * en una petición que va a fallar.
 *
 * Orden importante: primero se sube el archivo y RECIÉN DESPUÉS se crea el
 * registro, porque la URL que devuelve Cloudinary es parte de los datos a
 * guardar. Si la base de datos rechazara el equipo, el archivo recién subido
 * se borra para no dejarlo huérfano en Cloudinary.
 */
export async function crearEquipo(datos: DatosEquipoNuevo, archivos: ArchivosMedia): Promise<EquipoModel> {
  const { tipoMedia = TipoMedia.FOTO, disponibleParaAlquiler, ...camposEquipo } = datos;

  const archivo = validarArchivosDeMedio(tipoMedia, archivos);
  if (archivo === undefined) {
    throw new MediaInvalidoError(mensajeArchivoObligatorio(tipoMedia));
  }

  const medio = await subirMedio(tipoMedia, archivo);

  try {
    return await prisma.equipo.create({
      data: { ...camposEquipo, disponibleParaAlquiler: disponibleParaAlquiler ?? true, ...medio },
      include: { categoria: true },
    });
  } catch (error) {
    await eliminarArchivosDeMedio(medio);
    throw error;
  }
}

/**
 * Edita un equipo existente (actualización parcial: solo se toca lo que llegó).
 *
 * Reglas del medio al editar:
 *  - Sin archivo y sin cambiar el "tipoMedia": el medio actual no se toca (se
 *    puede editar el precio, el nombre, etc. sin volver a subir nada).
 *  - Con archivo (del tipo del equipo): reemplaza el medio actual.
 *  - Cambiando el "tipoMedia" (ej. de FOTO a VIDEO): el archivo del tipo
 *    NUEVO es obligatorio (si no, el equipo se quedaría sin medio). Se
 *    escriben los tres campos de medio juntos (ver la REGLA CENTRAL del
 *    encabezado), así que el medio del tipo anterior queda en null.
 *
 * Orden importante: 1) se valida todo, 2) se sube el archivo nuevo, 3) se
 * actualiza la base de datos y 4) RECIÉN DESPUÉS se borra de Cloudinary el
 * medio anterior. Si el paso 3 falla, el archivo nuevo se borra y el equipo
 * conserva su medio actual intacto; si el borrado del paso 4 falla, queda un
 * archivo huérfano pero el equipo ya está bien.
 */
export async function actualizarEquipo(
  id: number,
  datos: DatosEquipoEditados,
  archivos: ArchivosMedia
): Promise<EquipoModel> {
  // Se busca el equipo primero (y no se deja que el update falle con
  // "no encontrado"): así no se sube nada a Cloudinary para un equipo que no
  // existe, y se sabe cuál es su tipoMedia y sus archivos actuales.
  const equipoActual = await prisma.equipo.findUnique({ where: { id } });
  if (!equipoActual) {
    throw new EquipoNoEncontradoError();
  }

  // "tipoMedia" no se guarda con el resto de los campos de texto: viaja junto
  // con los demás campos de medio (en "medioNuevo", más abajo), que siempre
  // se escriben completos.
  const { tipoMedia: tipoSolicitado, ...camposEquipo } = datos;
  const tipoFinal = tipoSolicitado ?? equipoActual.tipoMedia;
  const cambiaDeTipo = tipoFinal !== equipoActual.tipoMedia;

  const archivo = validarArchivosDeMedio(tipoFinal, archivos);
  if (archivo === undefined && cambiaDeTipo) {
    throw new MediaInvalidoError(mensajeArchivoObligatorio(tipoFinal));
  }

  // Solo hay medio nuevo si llegó un archivo (siempre que cambie el tipo).
  const medioNuevo = archivo !== undefined ? await subirMedio(tipoFinal, archivo) : null;

  let equipo: EquipoModel;
  try {
    equipo = await prisma.equipo.update({
      where: { id },
      data: { ...camposEquipo, ...(medioNuevo ?? {}) },
      include: { categoria: true },
    });
  } catch (error) {
    // La base de datos no aplicó el cambio: el archivo recién subido no lo
    // referencia nadie, se borra para no dejarlo huérfano.
    if (medioNuevo !== null) {
      await eliminarArchivosDeMedio(medioNuevo);
    }
    // El equipo pudo borrarse entre la búsqueda de arriba y este update.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new EquipoNoEncontradoError();
    }
    throw error;
  }

  // El cambio ya está guardado: recién ahora se borra el medio anterior (la
  // imagen y/o el video que tenía), ya reemplazado por el nuevo.
  if (medioNuevo !== null) {
    await eliminarArchivosDeMedio(equipoActual);
  }

  return equipo;
}
