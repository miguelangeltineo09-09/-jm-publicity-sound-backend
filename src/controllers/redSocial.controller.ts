// ==========================================
// Controlador de Redes Sociales.
// Listar es público (el footer/contacto del sitio las muestra a
// cualquier visitante); crear, editar, eliminar y reordenar son
// exclusivos del admin. Mismo patrón general que
// preguntaFrecuente.controller.ts: una lista única y global (no anidada
// bajo ningún otro recurso), con reordenamiento por flechas.
// ==========================================

import type { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { Prisma } from "../generated/prisma/client";

// Chequeo mínimo de URL: alcanza para descartar strings que claramente
// no son un enlace (ej. "instagram.com" sin protocolo, o texto suelto),
// sin intentar validar cada regla de la spec de URLs — mismo criterio
// que FORMATO_EMAIL en otros controladores del proyecto.
const FORMATO_URL = /^https?:\/\/.+/i;

/**
 * GET /api/redes-sociales
 * Público: lista todas las redes sociales, ordenadas por "orden" (el
 * orden en que el admin quiere que se muestren).
 */
export async function listarRedesSociales(_req: Request, res: Response): Promise<void> {
  const redes = await prisma.redSocial.findMany({
    orderBy: { orden: "asc" },
  });

  res.status(200).json(redes);
}

/**
 * POST /api/redes-sociales
 * Admin: crea una red social nueva. Si no se manda "orden", se calcula
 * automáticamente como "el siguiente" (el mayor orden actual + 1, o 0 si
 * todavía no hay ninguna) — mismo criterio que crearPreguntaFrecuente.
 */
export async function crearRedSocial(req: Request, res: Response): Promise<void> {
  const { nombre, url, orden } = req.body as Record<string, unknown>;

  if (typeof nombre !== "string" || !nombre.trim()) {
    res.status(400).json({ error: "El campo 'nombre' es obligatorio y debe ser texto." });
    return;
  }

  if (typeof url !== "string" || !FORMATO_URL.test(url.trim())) {
    res.status(400).json({ error: "El campo 'url' es obligatorio y debe ser un enlace válido (http:// o https://)." });
    return;
  }

  let ordenNumerico: number;
  if (orden !== undefined) {
    ordenNumerico = Number(orden);
    if (!Number.isInteger(ordenNumerico)) {
      res.status(400).json({ error: "El campo 'orden' debe ser un número entero." });
      return;
    }
  } else {
    const ultimaRed = await prisma.redSocial.findFirst({ orderBy: { orden: "desc" } });
    ordenNumerico = ultimaRed ? ultimaRed.orden + 1 : 0;
  }

  const redCreada = await prisma.redSocial.create({
    data: { nombre: nombre.trim(), url: url.trim(), orden: ordenNumerico },
  });

  res.status(201).json(redCreada);
}

/**
 * PUT /api/redes-sociales/:id
 * Admin: edita el nombre y/o la url de una red social existente. Ambos
 * campos son opcionales AQUÍ (a diferencia de crear): se puede corregir
 * solo la url (ej. cambiaron de handle) sin retocar el nombre, o
 * viceversa. El "orden" no se toca desde este endpoint — eso es
 * responsabilidad exclusiva de PATCH /api/redes-sociales/orden.
 */
export async function actualizarRedSocial(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const { nombre, url } = req.body as Record<string, unknown>;

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "El id de la red social debe ser un número entero." });
    return;
  }

  if (nombre === undefined && url === undefined) {
    res.status(400).json({ error: "Debes mandar al menos uno de los campos 'nombre' o 'url'." });
    return;
  }

  if (nombre !== undefined && (typeof nombre !== "string" || !nombre.trim())) {
    res.status(400).json({ error: "El campo 'nombre', si se manda, debe ser texto no vacío." });
    return;
  }

  if (url !== undefined && (typeof url !== "string" || !FORMATO_URL.test(url.trim()))) {
    res.status(400).json({ error: "El campo 'url', si se manda, debe ser un enlace válido (http:// o https://)." });
    return;
  }

  try {
    const redActualizada = await prisma.redSocial.update({
      where: { id },
      data: {
        ...(nombre !== undefined ? { nombre: (nombre as string).trim() } : {}),
        ...(url !== undefined ? { url: (url as string).trim() } : {}),
      },
    });
    res.status(200).json(redActualizada);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      res.status(404).json({ error: "Red social no encontrada." });
      return;
    }
    throw error;
  }
}

/**
 * DELETE /api/redes-sociales/:id
 * Admin: elimina una red social puntual. No afecta el "orden" de las
 * demás: pueden quedar números no consecutivos, lo cual no rompe nada —
 * el listado las ordena igual, solo importa su orden RELATIVO entre sí.
 */
export async function eliminarRedSocial(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "El id de la red social debe ser un número entero." });
    return;
  }

  try {
    await prisma.redSocial.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      res.status(404).json({ error: "Red social no encontrada." });
      return;
    }
    throw error;
  }
}

// Forma esperada de cada entrada del array que recibe reordenarRedesSociales.
interface OrdenRedSocial {
  id: number;
  orden: number;
}

// Valida que el body sea un array de { id, orden } con ambos campos
// numéricos enteros. Mismo criterio que validarArrayDeOrdenes en
// preguntaFrecuente.controller.ts.
function validarArrayDeOrdenes(body: unknown): { error: string } | { items: OrdenRedSocial[] } {
  if (!Array.isArray(body) || body.length === 0) {
    return { error: "El body debe ser un array no vacío de { id, orden }." };
  }

  const items: OrdenRedSocial[] = [];
  for (const entrada of body) {
    const id = Number((entrada as Record<string, unknown>)?.id);
    const orden = Number((entrada as Record<string, unknown>)?.orden);
    if (!Number.isInteger(id) || !Number.isInteger(orden)) {
      return { error: "Cada elemento del array debe tener 'id' y 'orden' como números enteros." };
    }
    items.push({ id, orden });
  }

  return { items };
}

/**
 * PATCH /api/redes-sociales/orden
 * Admin: actualiza el "orden" de varias redes de una sola vez (ej. al
 * mover una con las flechas de subir/bajar). Body: [{ id, orden }, ...].
 * Todo se aplica dentro de una transacción: si una sola red fallara (ej.
 * no existe), NINGÚN cambio se guarda.
 */
export async function reordenarRedesSociales(req: Request, res: Response): Promise<void> {
  const resultadoValidacion = validarArrayDeOrdenes(req.body);
  if ("error" in resultadoValidacion) {
    res.status(400).json({ error: resultadoValidacion.error });
    return;
  }
  const { items } = resultadoValidacion;

  try {
    const redesActualizadas = await prisma.$transaction(async (tx) => {
      const idsExistentes = await tx.redSocial.findMany({
        where: { id: { in: items.map((item) => item.id) } },
        select: { id: true },
      });
      if (idsExistentes.length !== items.length) {
        throw new Error("REDES_NO_ENCONTRADAS");
      }

      return Promise.all(items.map((item) => tx.redSocial.update({ where: { id: item.id }, data: { orden: item.orden } })));
    });

    res.status(200).json(redesActualizadas);
  } catch (error) {
    if (error instanceof Error && error.message === "REDES_NO_ENCONTRADAS") {
      res.status(400).json({ error: "Una o más redes sociales del array no existen." });
      return;
    }
    throw error;
  }
}
