// ==========================================
// Controlador de Reseñas.
// Traduce las peticiones HTTP a llamadas a resena.service.ts (crear,
// calcular promedio) o directamente a Prisma (listar/cambiar
// estado/eliminar, que son operaciones simples sin lógica de negocio
// extra — mismo criterio que equipo.controller.ts/publicacion.controller.ts).
//
// Crear una reseña y ver las reseñas APROBADAS de un equipo son públicos;
// listar TODAS las reseñas, moderar y eliminar son exclusivos del admin
// (ver resena.routes.ts).
// ==========================================

import type { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { Prisma } from "../generated/prisma/client";
import type { ResenaWhereInput } from "../generated/prisma/models";
import { EstadoResena } from "../generated/prisma/enums";
import {
  EquipoNoEncontradoError,
  ResenaDuplicadaError,
  calcularPromedioCalificacion,
  crearResena,
} from "../services/resena.service";

// Escala de calificación de la reseña (estrellas 1 a 5).
const CALIFICACION_MINIMA = 1;
const CALIFICACION_MAXIMA = 5;

/**
 * POST /api/resenas
 * Público: cualquier cliente puede dejar una reseña de un equipo, sin
 * necesitar cuenta. Nace PENDIENTE — el mensaje de respuesta le avisa al
 * cliente que todavía falta la revisión del admin, para que no espere
 * verla publicada de inmediato.
 */
export async function crearResenaHandler(req: Request, res: Response): Promise<void> {
  const { equipoId, nombreCliente, calificacion, comentario } = req.body as Record<string, unknown>;

  // --- Validación de los campos de entrada ---
  const equipoIdNumerico = Number(equipoId);
  if (!Number.isInteger(equipoIdNumerico)) {
    res.status(400).json({ error: "El campo 'equipoId' es obligatorio y debe ser un número entero." });
    return;
  }

  if (typeof nombreCliente !== "string" || !nombreCliente.trim()) {
    res.status(400).json({ error: "El campo 'nombreCliente' es obligatorio y debe ser texto." });
    return;
  }

  const calificacionNumerica = Number(calificacion);
  if (
    !Number.isInteger(calificacionNumerica) ||
    calificacionNumerica < CALIFICACION_MINIMA ||
    calificacionNumerica > CALIFICACION_MAXIMA
  ) {
    res.status(400).json({
      error: `El campo 'calificacion' es obligatorio y debe ser un número entero entre ${CALIFICACION_MINIMA} y ${CALIFICACION_MAXIMA}.`,
    });
    return;
  }

  if (comentario !== undefined && comentario !== null && typeof comentario !== "string") {
    res.status(400).json({ error: "El campo 'comentario' debe ser texto." });
    return;
  }

  try {
    await crearResena({
      equipoId: equipoIdNumerico,
      nombreCliente: nombreCliente.trim(),
      calificacion: calificacionNumerica,
      comentario: typeof comentario === "string" && comentario.trim() ? comentario.trim() : undefined,
    });

    // No se devuelve la reseña creada como si ya estuviera "lista": el
    // mensaje deja claro que todavía falta la revisión del admin.
    res.status(201).json({
      mensaje: "¡Gracias por tu reseña! Quedará visible una vez sea revisada por el equipo administrativo.",
    });
  } catch (error) {
    if (error instanceof EquipoNoEncontradoError) {
      res.status(404).json({ error: `No existe un equipo con id ${equipoIdNumerico}.` });
      return;
    }
    if (error instanceof ResenaDuplicadaError) {
      // 429 (Too Many Requests): es, literalmente, un envío repetido en
      // muy poco tiempo, no un error de validación de los datos en sí.
      res.status(429).json({
        error: "Ya enviaste una reseña para este equipo hace muy poco. Espera unos minutos antes de volver a intentarlo.",
      });
      return;
    }
    throw error;
  }
}

/**
 * GET /api/equipos/:id/resenas
 * Público: SOLO las reseñas APROBADA de ese equipo (nunca PENDIENTE ni
 * RECHAZADA), junto con el promedio de calificación y el total —
 * exactamente lo que necesita mostrar la ficha pública del equipo.
 */
export async function listarResenasDeEquipo(req: Request, res: Response): Promise<void> {
  const equipoId = Number(req.params.id);

  if (!Number.isInteger(equipoId)) {
    res.status(400).json({ error: "El id del equipo debe ser un número entero." });
    return;
  }

  const equipo = await prisma.equipo.findUnique({ where: { id: equipoId } });
  if (!equipo) {
    res.status(404).json({ error: "Equipo no encontrado." });
    return;
  }

  // Ambas consultas son independientes entre sí: se piden en paralelo.
  const [resenas, { promedio, total }] = await Promise.all([
    prisma.resena.findMany({
      where: { equipoId, estado: EstadoResena.APROBADA },
      orderBy: { createdAt: "desc" },
    }),
    calcularPromedioCalificacion(equipoId),
  ]);

  res.status(200).json({ resenas, promedio, total });
}

/**
 * GET /api/resenas
 * Admin: lista TODAS las reseñas sin importar su estado, con el equipo
 * incluido. Soporta ?estado= para que el admin filtre, ej. las PENDIENTE
 * primero (las que realmente necesitan su atención).
 */
export async function listarResenas(req: Request, res: Response): Promise<void> {
  const { estado } = req.query;

  const where: ResenaWhereInput = {};

  if (estado !== undefined) {
    if (typeof estado !== "string" || !Object.values(EstadoResena).includes(estado as EstadoResena)) {
      res.status(400).json({
        error: `El query param 'estado' debe ser uno de: ${Object.values(EstadoResena).join(", ")}.`,
      });
      return;
    }
    where.estado = estado as EstadoResena;
  }

  const resenas = await prisma.resena.findMany({
    where,
    include: { equipo: true },
    orderBy: { createdAt: "desc" },
  });

  res.status(200).json(resenas);
}

/**
 * PATCH /api/resenas/:id/estado
 * Admin: aprueba o rechaza una reseña (el único lugar donde una reseña
 * deja de estar PENDIENTE). No se permite volver a poner "PENDIENTE" a
 * mano: es el estado inicial, no una opción de moderación.
 */
export async function actualizarEstadoResena(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const { estado } = req.body as { estado?: unknown };

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "El id de la reseña debe ser un número entero." });
    return;
  }

  if (estado !== EstadoResena.APROBADA && estado !== EstadoResena.RECHAZADA) {
    res.status(400).json({ error: "El campo 'estado' debe ser 'APROBADA' o 'RECHAZADA'." });
    return;
  }

  try {
    const resena = await prisma.resena.update({
      where: { id },
      data: { estado },
      include: { equipo: true },
    });
    res.status(200).json(resena);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      res.status(404).json({ error: "Reseña no encontrada." });
      return;
    }
    throw error;
  }
}

/**
 * DELETE /api/resenas/:id
 * Admin: borrado definitivo (spam evidente, contenido inapropiado). A
 * diferencia de RECHAZADA, esto no deja ningún rastro en el historial de
 * moderación.
 */
export async function eliminarResena(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "El id de la reseña debe ser un número entero." });
    return;
  }

  try {
    await prisma.resena.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      res.status(404).json({ error: "Reseña no encontrada." });
      return;
    }
    throw error;
  }
}
