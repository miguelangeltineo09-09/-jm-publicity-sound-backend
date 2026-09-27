// ==========================================
// Controlador de Equipos.
// Traduce las peticiones HTTP de /api/equipos a operaciones sobre Prisma
// (listar, detalle, borrar, cambiar disponibilidad) o a llamadas a
// equipo.service.ts (crear y editar, que involucran el archivo del medio
// principal del equipo —una imagen o un video— y su subida a Cloudinary).
// La lectura (listar/detalle) es pública; crear/editar/eliminar/cambiar
// disponibilidad requieren admin autenticado (ver equipo.routes.ts).
// ==========================================

import type { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { Prisma } from "../generated/prisma/client";
import type { EquipoWhereInput } from "../generated/prisma/models";
import { EstadoReserva, TipoMedia } from "../generated/prisma/enums";
import {
  EquipoNoEncontradoError,
  MediaInvalidoError,
  actualizarEquipo as actualizarEquipoService,
  crearEquipo as crearEquipoService,
} from "../services/equipo.service";
import type { ArchivosMedia } from "../services/equipo.service";

// Reservas en estos estados siguen "activas": bloquean el borrado del equipo
// porque hay un compromiso pendiente o confirmado con un cliente.
const ESTADOS_RESERVA_ACTIVOS: EstadoReserva[] = [
  EstadoReserva.PENDIENTE,
  EstadoReserva.CONFIRMADA,
];

/**
 * GET /api/equipos
 * Lista equipos junto con su categoría (include). Soporta filtrar por
 * ?categoriaId=<id> para las vistas de catálogo filtradas por categoría.
 */
export async function listarEquipos(req: Request, res: Response): Promise<void> {
  const { categoriaId } = req.query;

  const where: EquipoWhereInput = {};

  if (categoriaId !== undefined) {
    const idNumerico = Number(categoriaId);
    if (!Number.isInteger(idNumerico)) {
      res.status(400).json({ error: "El query param 'categoriaId' debe ser un número entero." });
      return;
    }
    where.categoriaId = idNumerico;
  }

  const equipos = await prisma.equipo.findMany({
    where,
    include: { categoria: true },
    orderBy: { createdAt: "desc" },
  });

  res.status(200).json(equipos);
}

/**
 * GET /api/equipos/:id
 * Detalle de un equipo puntual, con su categoría y sus ítems incluidos ya
 * ordenados — así el frontend puede armar toda la ficha de detalle con
 * una sola consulta, sin pedir /items-incluidos por separado.
 */
export async function obtenerEquipo(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "El id del equipo debe ser un número entero." });
    return;
  }

  const equipo = await prisma.equipo.findUnique({
    where: { id },
    include: { categoria: true, itemsIncluidos: { orderBy: { orden: "asc" } } },
  });

  if (!equipo) {
    res.status(404).json({ error: "Equipo no encontrado." });
    return;
  }

  res.status(200).json(equipo);
}

// Valida y normaliza los campos de texto/número que llegan en el body
// (multipart/form-data entrega todo como string). Se comparte entre crear
// y actualizar; en actualizar solo se validan los campos que sí llegaron.
interface DatosEquipoValidados {
  nombre?: string;
  descripcion?: string;
  // Texto libre (ya no un número): ver el comentario de la validación de
  // "precio" en validarDatosEquipo.
  precio?: string;
  categoriaId?: number;
  disponibleParaAlquiler?: boolean;
  // Medio principal del equipo (ver el enum TipoMedia en prisma/schema.prisma).
  tipoMedia?: TipoMedia;
}

async function validarDatosEquipo(
  body: Record<string, unknown>,
  { parcial }: { parcial: boolean }
): Promise<{ error: string } | { datos: DatosEquipoValidados }> {
  const datos: DatosEquipoValidados = {};

  // --- nombre ---
  if (body.nombre !== undefined || !parcial) {
    if (typeof body.nombre !== "string" || !body.nombre.trim()) {
      return { error: "El campo 'nombre' es obligatorio y debe ser texto." };
    }
    datos.nombre = body.nombre.trim();
  }

  // --- descripcion ---
  if (body.descripcion !== undefined || !parcial) {
    if (typeof body.descripcion !== "string" || !body.descripcion.trim()) {
      return { error: "El campo 'descripcion' es obligatorio y debe ser texto." };
    }
    datos.descripcion = body.descripcion.trim();
  }

  // --- precio ---
  // Acepta cualquier texto no vacío (ya NO se exige que sea un número
  // positivo): puede contener un número escrito como texto (ej. "45000") o
  // una frase (ej. "Negociable en privado", "Precio a consultar"), para los
  // equipos cuyo monto se acuerda con el cliente. Se guarda tal cual (solo
  // se recortan los espacios de los extremos): interpretarlo como número es
  // trabajo de parsearPrecioNumerico() (src/utils/precio.ts), justo en el
  // momento en que el sistema necesita calcular con él.
  if (body.precio !== undefined || !parcial) {
    // Un cliente que mande JSON (en vez de multipart/form-data) puede enviar
    // el precio como número (ej. 45000): se convierte a texto para no
    // rechazar lo que antes sí se aceptaba.
    const precioTexto =
      typeof body.precio === "number" && Number.isFinite(body.precio) ? String(body.precio) : body.precio;

    if (typeof precioTexto !== "string" || !precioTexto.trim()) {
      return {
        error:
          "El campo 'precio' es obligatorio y debe ser un texto no vacío (ej. \"45000\" o \"Negociable en privado\").",
      };
    }
    datos.precio = precioTexto.trim();
  }

  // --- categoriaId ---
  if (body.categoriaId !== undefined || !parcial) {
    const categoriaIdNumerico = Number(body.categoriaId);
    if (typeof body.categoriaId === "undefined" || !Number.isInteger(categoriaIdNumerico)) {
      return { error: "El campo 'categoriaId' es obligatorio y debe ser un número entero." };
    }

    const categoriaExiste = await prisma.categoria.findUnique({
      where: { id: categoriaIdNumerico },
    });
    if (!categoriaExiste) {
      return { error: `No existe una categoría con id ${categoriaIdNumerico}.` };
    }

    datos.categoriaId = categoriaIdNumerico;
  }

  // --- disponibleParaAlquiler (opcional en ambos casos, con default true al crear) ---
  if (body.disponibleParaAlquiler !== undefined) {
    // Llega como string "true"/"false" en multipart/form-data.
    if (body.disponibleParaAlquiler === "true" || body.disponibleParaAlquiler === true) {
      datos.disponibleParaAlquiler = true;
    } else if (body.disponibleParaAlquiler === "false" || body.disponibleParaAlquiler === false) {
      datos.disponibleParaAlquiler = false;
    } else {
      return { error: "El campo 'disponibleParaAlquiler' debe ser 'true' o 'false'." };
    }
  }

  // --- tipoMedia (opcional) ---
  // "FOTO" o "VIDEO". Si no se manda: al CREAR el equipo queda como FOTO, y
  // al EDITAR conserva el tipo que ya tenía. Cambiarlo al editar exige
  // además enviar el archivo del tipo nuevo (ver equipo.service.ts).
  if (body.tipoMedia !== undefined) {
    if (body.tipoMedia !== TipoMedia.FOTO && body.tipoMedia !== TipoMedia.VIDEO) {
      return { error: "El campo 'tipoMedia' debe ser 'FOTO' o 'VIDEO'." };
    }
    datos.tipoMedia = body.tipoMedia;
  }

  return { datos };
}

// Saca de la petición los archivos del medio (imagen y/o video) como buffers
// en memoria. Con multer configurado vía ".fields([...])" (ver
// recibirMediaEquipo en src/config/multer.ts), "req.files" llega como un
// objeto agrupado por nombre de campo; si la petición no era multipart (ej.
// un JSON sin archivos), llega sin definir y no hay ningún archivo.
function leerArchivosMedia(req: Request): ArchivosMedia {
  const archivos = req.files as { imagen?: Express.Multer.File[]; video?: Express.Multer.File[] } | undefined;
  return { imagen: archivos?.imagen?.[0]?.buffer, video: archivos?.video?.[0]?.buffer };
}

/**
 * POST /api/equipos
 * Crea un equipo nuevo. Espera multipart/form-data: los campos del equipo,
 * "tipoMedia" ("FOTO" por defecto, o "VIDEO") y el archivo de su medio
 * principal (ver multer en equipo.routes.ts):
 * - tipoMedia="FOTO": una imagen en el campo "imagen".
 * - tipoMedia="VIDEO": un video en el campo "video".
 * Es obligatorio enviar exactamente UNO de los dos, el que corresponda al
 * tipo. El archivo se sube a Cloudinary y su URL se guarda en imagenUrl
 * (FOTO) o en videoUrl y thumbnailUrl (VIDEO); ver equipo.service.ts.
 */
export async function crearEquipo(req: Request, res: Response): Promise<void> {
  const resultado = await validarDatosEquipo(req.body, { parcial: false });

  if ("error" in resultado) {
    res.status(400).json({ error: resultado.error });
    return;
  }

  const { nombre, descripcion, precio, categoriaId, disponibleParaAlquiler, tipoMedia } = resultado.datos;

  try {
    const equipo = await crearEquipoService(
      {
        nombre: nombre!,
        descripcion: descripcion!,
        precio: precio!,
        categoriaId: categoriaId!,
        disponibleParaAlquiler,
        tipoMedia,
      },
      leerArchivosMedia(req)
    );
    res.status(201).json(equipo);
  } catch (error) {
    if (error instanceof MediaInvalidoError) {
      res.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }
}

/**
 * PUT /api/equipos/:id
 * Edita un equipo existente. Solo valida/actualiza los campos que llegaron
 * en el body (actualización parcial). El medio principal se puede reemplazar
 * enviando un archivo nuevo (imagen o video, según el tipo del equipo), y se
 * puede cambiar el equipo de FOTO a VIDEO (o al revés) enviando "tipoMedia"
 * junto con el archivo del tipo nuevo. El medio anterior se borra de
 * Cloudinary y sus campos quedan en null; las reglas completas están en
 * actualizarEquipo de equipo.service.ts.
 */
export async function actualizarEquipo(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "El id del equipo debe ser un número entero." });
    return;
  }

  const resultado = await validarDatosEquipo(req.body, { parcial: true });

  if ("error" in resultado) {
    res.status(400).json({ error: resultado.error });
    return;
  }

  try {
    const equipo = await actualizarEquipoService(id, resultado.datos, leerArchivosMedia(req));
    res.status(200).json(equipo);
  } catch (error) {
    if (error instanceof EquipoNoEncontradoError) {
      res.status(404).json({ error: "Equipo no encontrado." });
      return;
    }
    if (error instanceof MediaInvalidoError) {
      res.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }
}

/**
 * DELETE /api/equipos/:id
 * Elimina un equipo, salvo que tenga reservas PENDIENTE o CONFIRMADA: esas
 * representan un compromiso real con un cliente que no debería desaparecer
 * de golpe. Las reservas RECHAZADA sí se eliminan en cascada (ver
 * onDelete: Cascade en prisma/schema.prisma).
 */
export async function eliminarEquipo(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "El id del equipo debe ser un número entero." });
    return;
  }

  // Ya no existe Reserva.equipoId (una reserva ahora puede tener varios
  // equipos, ver ReservaEquipo en prisma/schema.prisma): se cuenta a
  // través de la relación "equipos", cualquier reserva activa que incluya
  // este equipo entre los suyos.
  const cantidadReservasActivas = await prisma.reserva.count({
    where: { equipos: { some: { equipoId: id } }, estado: { in: ESTADOS_RESERVA_ACTIVOS } },
  });

  if (cantidadReservasActivas > 0) {
    res.status(400).json({
      error: `No se puede eliminar el equipo: tiene ${cantidadReservasActivas} reserva(s) pendiente(s) o confirmada(s). Resuélvelas primero o desactiva el equipo con PATCH /disponibilidad.`,
    });
    return;
  }

  try {
    await prisma.equipo.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      res.status(404).json({ error: "Equipo no encontrado." });
      return;
    }
    throw error;
  }
}

/**
 * PATCH /api/equipos/:id/disponibilidad
 * Activa/desactiva el equipo sin borrarlo, para sacarlo temporalmente del
 * catálogo (ej. está en mantenimiento) conservando su historial de reservas.
 */
export async function cambiarDisponibilidad(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const { disponibleParaAlquiler } = req.body as { disponibleParaAlquiler?: unknown };

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "El id del equipo debe ser un número entero." });
    return;
  }

  if (typeof disponibleParaAlquiler !== "boolean") {
    res.status(400).json({ error: "El campo 'disponibleParaAlquiler' es obligatorio y debe ser booleano." });
    return;
  }

  try {
    const equipo = await prisma.equipo.update({
      where: { id },
      data: { disponibleParaAlquiler },
    });
    res.status(200).json(equipo);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      res.status(404).json({ error: "Equipo no encontrado." });
      return;
    }
    throw error;
  }
}
