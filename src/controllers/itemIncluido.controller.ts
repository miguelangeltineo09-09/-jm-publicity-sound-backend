// ==========================================
// Controlador de Ítems Incluidos (lo que trae el alquiler de un Equipo,
// ej. "4 monitores", "1 planta eléctrica").
//
// Listar los ítems de un equipo es público (la ficha de detalle del
// catálogo los muestra a cualquier visitante); crear, editar, eliminar y
// reordenar son exclusivos del admin. Los handlers de acá se montan desde
// DOS routers distintos, según a qué URL pertenece cada uno (ver el
// comentario al inicio de itemIncluido.routes.ts):
// - listarItemsIncluidos / crearItemIncluido / reordenarItemsIncluidos
//   se montan en equipo.routes.ts, anidados bajo /api/equipos/:id — mismo
//   criterio que listarResenasDeEquipo en resena.controller.ts.
// - actualizarItemIncluido / eliminarItemIncluido se montan en
//   itemIncluido.routes.ts, como rutas propias bajo /api/items-incluidos,
//   porque operan sobre un ítem puntual por su propio id, sin necesitar el
//   equipoId en la URL.
// ==========================================

import type { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { Prisma } from "../generated/prisma/client";

/**
 * GET /api/equipos/:id/items-incluidos
 * Público: lista los ítems de ese equipo, ordenados por el campo "orden"
 * (el orden en que el admin quiere que se muestren, no por fecha de creación).
 */
export async function listarItemsIncluidos(req: Request, res: Response): Promise<void> {
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

  const items = await prisma.itemIncluido.findMany({
    where: { equipoId },
    orderBy: { orden: "asc" },
  });

  res.status(200).json(items);
}

/**
 * POST /api/equipos/:id/items-incluidos
 * Admin: agrega un ítem nuevo a ese equipo. Si no se manda "orden", se
 * calcula automáticamente como "el siguiente" (el mayor orden actual + 1,
 * o 0 si todavía no tiene ningún ítem) para que el ítem nuevo aparezca al
 * final de la lista por defecto, sin que el admin tenga que calcularlo a mano.
 */
export async function crearItemIncluido(req: Request, res: Response): Promise<void> {
  const equipoId = Number(req.params.id);
  const { descripcion, orden } = req.body as Record<string, unknown>;

  if (!Number.isInteger(equipoId)) {
    res.status(400).json({ error: "El id del equipo debe ser un número entero." });
    return;
  }

  if (typeof descripcion !== "string" || !descripcion.trim()) {
    res.status(400).json({ error: "El campo 'descripcion' es obligatorio y debe ser texto." });
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
    // "el siguiente": mayor orden actual + 1 (0 si es el primer ítem del equipo).
    const ultimoItem = await prisma.itemIncluido.findFirst({
      where: { equipoId },
      orderBy: { orden: "desc" },
    });
    ordenNumerico = ultimoItem ? ultimoItem.orden + 1 : 0;
  }

  const equipo = await prisma.equipo.findUnique({ where: { id: equipoId } });
  if (!equipo) {
    res.status(404).json({ error: "Equipo no encontrado." });
    return;
  }

  const item = await prisma.itemIncluido.create({
    data: { equipoId, descripcion: descripcion.trim(), orden: ordenNumerico },
  });

  res.status(201).json(item);
}

/**
 * PUT /api/items-incluidos/:itemId
 * Admin: edita la descripción de un ítem existente. No permite cambiar el
 * "orden" desde aquí — eso es responsabilidad exclusiva de
 * PATCH /api/equipos/:id/items-incluidos/orden, para no tener dos caminos
 * distintos que puedan pisarse entre sí.
 */
export async function actualizarItemIncluido(req: Request, res: Response): Promise<void> {
  const itemId = Number(req.params.itemId);
  const { descripcion } = req.body as Record<string, unknown>;

  if (!Number.isInteger(itemId)) {
    res.status(400).json({ error: "El id del ítem debe ser un número entero." });
    return;
  }

  if (typeof descripcion !== "string" || !descripcion.trim()) {
    res.status(400).json({ error: "El campo 'descripcion' es obligatorio y debe ser texto." });
    return;
  }

  try {
    const item = await prisma.itemIncluido.update({
      where: { id: itemId },
      data: { descripcion: descripcion.trim() },
    });
    res.status(200).json(item);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      res.status(404).json({ error: "Ítem no encontrado." });
      return;
    }
    throw error;
  }
}

/**
 * DELETE /api/items-incluidos/:itemId
 * Admin: elimina un ítem puntual. No afecta el "orden" de los demás
 * ítems del mismo equipo: pueden quedar números no consecutivos (ej.
 * 0, 2, 3 tras borrar el que tenía "orden: 1"), lo cual no rompe nada — el
 * listado los ordena igual, solo importa su orden RELATIVO entre sí.
 */
export async function eliminarItemIncluido(req: Request, res: Response): Promise<void> {
  const itemId = Number(req.params.itemId);

  if (!Number.isInteger(itemId)) {
    res.status(400).json({ error: "El id del ítem debe ser un número entero." });
    return;
  }

  try {
    await prisma.itemIncluido.delete({ where: { id: itemId } });
    res.status(204).send();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      res.status(404).json({ error: "Ítem no encontrado." });
      return;
    }
    throw error;
  }
}

// Forma esperada de cada entrada del array que recibe reordenarItemsIncluidos.
interface OrdenItem {
  id: number;
  orden: number;
}

// Valida que el body sea un array de { id, orden } con ambos campos
// numéricos enteros. Se comparte por si en el futuro hace falta reusar esta
// validación, y para no ensuciar el handler principal con este detalle.
function validarArrayDeOrdenes(body: unknown): { error: string } | { items: OrdenItem[] } {
  if (!Array.isArray(body) || body.length === 0) {
    return { error: "El body debe ser un array no vacío de { id, orden }." };
  }

  const items: OrdenItem[] = [];
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
 * PATCH /api/equipos/:id/items-incluidos/orden
 * Admin: actualiza el "orden" de varios ítems de un mismo equipo de una
 * sola vez (ej. al arrastrar y soltar en la interfaz de admin). Body:
 * [{ id, orden }, ...].
 *
 * Todo se aplica dentro de una transacción: si un solo ítem fallara (ej.
 * no existe o no pertenece a este equipo), NINGÚN cambio se guarda — mejor
 * que dejar el reordenamiento a medio aplicar, con unos ítems ya movidos y
 * otros no.
 */
export async function reordenarItemsIncluidos(req: Request, res: Response): Promise<void> {
  const equipoId = Number(req.params.id);

  if (!Number.isInteger(equipoId)) {
    res.status(400).json({ error: "El id del equipo debe ser un número entero." });
    return;
  }

  const resultadoValidacion = validarArrayDeOrdenes(req.body);
  if ("error" in resultadoValidacion) {
    res.status(400).json({ error: resultadoValidacion.error });
    return;
  }
  const { items } = resultadoValidacion;

  try {
    const itemsActualizados = await prisma.$transaction(async (tx) => {
      // Se verifica que TODOS los ids pertenezcan a este equipo antes de
      // tocar nada: evita que, por error o de forma malintencionada, se
      // reordenen ítems de un equipo distinto al que dice la URL.
      const idsExistentesDelEquipo = await tx.itemIncluido.findMany({
        where: { equipoId, id: { in: items.map((item) => item.id) } },
        select: { id: true },
      });
      if (idsExistentesDelEquipo.length !== items.length) {
        throw new Error("ITEMS_NO_PERTENECEN_AL_EQUIPO");
      }

      return Promise.all(
        items.map((item) => tx.itemIncluido.update({ where: { id: item.id }, data: { orden: item.orden } }))
      );
    });

    res.status(200).json(itemsActualizados);
  } catch (error) {
    if (error instanceof Error && error.message === "ITEMS_NO_PERTENECEN_AL_EQUIPO") {
      res.status(400).json({
        error: "Uno o más ítems no existen o no pertenecen a este equipo.",
      });
      return;
    }
    throw error;
  }
}
