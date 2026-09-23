// ==========================================
// Controlador de Publicaciones de eventos.
// Traduce las peticiones HTTP de /api/publicaciones a llamadas a
// publicacion.service.ts (para crear/eliminar, que involucran Cloudinary)
// o directamente a Prisma (para listar/detalle/editar, que son consultas
// simples sin lógica de negocio extra — mismo criterio que equipo.controller.ts).
// Listar y ver detalle son públicos; crear/editar/eliminar requieren admin
// autenticado (ver publicacion.routes.ts).
// ==========================================

import type { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { Prisma } from "../generated/prisma/client";
import type { PublicacionEventoUpdateInput, PublicacionEventoWhereInput } from "../generated/prisma/models";
import { TipoPublicacion } from "../generated/prisma/enums";
import {
  EquipoNoEncontradoError,
  PublicacionNoEncontradaError,
  crearPublicacionFoto,
  crearPublicacionVideo,
  eliminarPublicacion as eliminarPublicacionService,
} from "../services/publicacion.service";

// Con multer configurado vía ".fields([...])" (ver publicacion.routes.ts),
// req.files llega como un objeto agrupado por nombre de campo, no como un
// array plano.
interface ArchivosPublicacion {
  video?: Express.Multer.File[];
  imagenes?: Express.Multer.File[];
}

/**
 * POST /api/publicaciones
 * Crea una publicación. Multipart/form-data con: titulo, comentario
 * (opcional), tipo ("FOTO" | "VIDEO"), equipoId, destacado (opcional), y:
 * - si tipo="VIDEO": exactamente un archivo en el campo "video".
 * - si tipo="FOTO": uno o más archivos en el campo "imagenes".
 */
export async function crearPublicacion(req: Request, res: Response): Promise<void> {
  const { titulo, comentario, tipo, equipoId, destacado } = req.body as Record<string, unknown>;
  const archivos = req.files as ArchivosPublicacion | undefined;

  // --- Validación de los campos de texto/número comunes a ambos tipos ---
  if (typeof titulo !== "string" || !titulo.trim()) {
    res.status(400).json({ error: "El campo 'titulo' es obligatorio." });
    return;
  }

  if (tipo !== TipoPublicacion.FOTO && tipo !== TipoPublicacion.VIDEO) {
    res.status(400).json({ error: "El campo 'tipo' debe ser 'FOTO' o 'VIDEO'." });
    return;
  }

  const equipoIdNumerico = Number(equipoId);
  if (!Number.isInteger(equipoIdNumerico)) {
    res.status(400).json({ error: "El campo 'equipoId' es obligatorio y debe ser un número entero." });
    return;
  }

  // "destacado" es opcional (default false); llega como string en
  // multipart/form-data, igual que "disponibleParaAlquiler" en equipo.controller.ts.
  let destacadoBooleano = false;
  if (destacado !== undefined) {
    if (destacado === "true" || destacado === true) {
      destacadoBooleano = true;
    } else if (destacado === "false" || destacado === false) {
      destacadoBooleano = false;
    } else {
      res.status(400).json({ error: "El campo 'destacado' debe ser 'true' o 'false'." });
      return;
    }
  }

  const datosComunes = {
    titulo: titulo.trim(),
    comentario: typeof comentario === "string" && comentario.trim() ? comentario.trim() : undefined,
    equipoId: equipoIdNumerico,
    destacado: destacadoBooleano,
  };

  try {
    if (tipo === TipoPublicacion.VIDEO) {
      const archivoVideo = archivos?.video?.[0];
      // Ni más ni menos de un archivo, y en el campo correcto: si llegó
      // algo en "imagenes" junto con el video, es un error del que llama
      // (mezcló los dos formatos), no algo que debamos adivinar.
      if (!archivoVideo || (archivos?.imagenes?.length ?? 0) > 0) {
        res.status(400).json({
          error:
            "Una publicación de tipo VIDEO debe incluir exactamente un archivo en el campo 'video', y ningún archivo en 'imagenes'.",
        });
        return;
      }

      const publicacion = await crearPublicacionVideo({ ...datosComunes, archivoVideo: archivoVideo.buffer });
      res.status(201).json(publicacion);
      return;
    }

    // tipo === TipoPublicacion.FOTO
    const archivosImagenes = archivos?.imagenes ?? [];
    if (archivosImagenes.length === 0 || (archivos?.video?.length ?? 0) > 0) {
      res.status(400).json({
        error:
          "Una publicación de tipo FOTO debe incluir una o más imágenes en el campo 'imagenes', y ningún archivo en 'video'.",
      });
      return;
    }

    const publicacion = await crearPublicacionFoto({
      ...datosComunes,
      archivosImagenes: archivosImagenes.map((archivo) => archivo.buffer),
    });
    res.status(201).json(publicacion);
  } catch (error) {
    if (error instanceof EquipoNoEncontradoError) {
      res.status(400).json({ error: `No existe un equipo con id ${equipoIdNumerico}.` });
      return;
    }
    throw error;
  }
}

/**
 * GET /api/publicaciones
 * Lista publicaciones con su equipo y (si es tipo FOTO) sus imágenes ya
 * ordenadas para el carrusel. Soporta ?equipoId= y ?destacado=true/false.
 */
export async function listarPublicaciones(req: Request, res: Response): Promise<void> {
  const { equipoId, destacado } = req.query;

  const where: PublicacionEventoWhereInput = {};

  if (equipoId !== undefined) {
    const equipoIdNumerico = Number(equipoId);
    if (!Number.isInteger(equipoIdNumerico)) {
      res.status(400).json({ error: "El query param 'equipoId' debe ser un número entero." });
      return;
    }
    where.equipoId = equipoIdNumerico;
  }

  if (destacado !== undefined) {
    if (destacado !== "true" && destacado !== "false") {
      res.status(400).json({ error: "El query param 'destacado' debe ser 'true' o 'false'." });
      return;
    }
    where.destacado = destacado === "true";
  }

  const publicaciones = await prisma.publicacionEvento.findMany({
    where,
    include: { equipo: true, imagenes: { orderBy: { orden: "asc" } } },
    orderBy: { createdAt: "desc" },
  });

  res.status(200).json(publicaciones);
}

/**
 * GET /api/publicaciones/:id
 * Detalle de una publicación puntual, con su equipo y todas sus imágenes
 * (si es tipo FOTO) ya ordenadas.
 */
export async function obtenerPublicacion(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "El id de la publicación debe ser un número entero." });
    return;
  }

  const publicacion = await prisma.publicacionEvento.findUnique({
    where: { id },
    include: { equipo: true, imagenes: { orderBy: { orden: "asc" } } },
  });

  if (!publicacion) {
    res.status(404).json({ error: "Publicación no encontrada." });
    return;
  }

  res.status(200).json(publicacion);
}

/**
 * PATCH /api/publicaciones/:id
 * Solo permite editar titulo, comentario y destacado. NO permite cambiar
 * el contenido multimedia (video/imágenes): si el admin quiere cambiar el
 * contenido, la publicación se borra (DELETE, que además limpia
 * Cloudinary) y se crea una nueva.
 */
export async function actualizarPublicacion(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "El id de la publicación debe ser un número entero." });
    return;
  }

  const { titulo, comentario, destacado } = req.body as Record<string, unknown>;
  const datos: PublicacionEventoUpdateInput = {};

  if (titulo !== undefined) {
    if (typeof titulo !== "string" || !titulo.trim()) {
      res.status(400).json({ error: "El campo 'titulo' debe ser texto no vacío." });
      return;
    }
    datos.titulo = titulo.trim();
  }

  if (comentario !== undefined) {
    if (comentario !== null && typeof comentario !== "string") {
      res.status(400).json({ error: "El campo 'comentario' debe ser texto." });
      return;
    }
    datos.comentario = comentario === null ? null : comentario.trim();
  }

  if (destacado !== undefined) {
    if (typeof destacado !== "boolean") {
      res.status(400).json({ error: "El campo 'destacado' debe ser booleano." });
      return;
    }
    datos.destacado = destacado;
  }

  try {
    const publicacion = await prisma.publicacionEvento.update({
      where: { id },
      data: datos,
      include: { equipo: true, imagenes: { orderBy: { orden: "asc" } } },
    });
    res.status(200).json(publicacion);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      res.status(404).json({ error: "Publicación no encontrada." });
      return;
    }
    throw error;
  }
}

/**
 * DELETE /api/publicaciones/:id
 * Elimina el registro, sus ImagenPublicacion asociadas (cascada en el
 * schema) y los archivos reales en Cloudinary (ver publicacion.service.ts).
 */
export async function eliminarPublicacion(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "El id de la publicación debe ser un número entero." });
    return;
  }

  try {
    await eliminarPublicacionService(id);
    res.status(204).send();
  } catch (error) {
    if (error instanceof PublicacionNoEncontradaError) {
      res.status(404).json({ error: "Publicación no encontrada." });
      return;
    }
    throw error;
  }
}
