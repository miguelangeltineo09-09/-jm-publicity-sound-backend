// ==========================================
// Controlador de Preguntas Frecuentes.
// Listar es público (la sección "Preguntas frecuentes" del sitio la
// muestra a cualquier visitante); crear, editar, eliminar y reordenar son
// exclusivos del admin (ver preguntaFrecuente.routes.ts). Mismo criterio
// general que categoria.controller.ts, con el agregado del reordenamiento
// (mismo patrón que itemIncluido.controller.ts, pero sin necesitar
// verificar que los ids "pertenezcan" a nada: a diferencia de los ítems
// incluidos de un equipo, las preguntas frecuentes no están anidadas bajo
// ningún otro recurso, son una lista única y global).
// ==========================================

import type { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { Prisma } from "../generated/prisma/client";

/**
 * GET /api/preguntas-frecuentes
 * Público: lista todas las preguntas frecuentes, ordenadas por "orden"
 * (el orden en que el admin quiere que se muestren, no por fecha de
 * creación).
 */
export async function listarPreguntasFrecuentes(_req: Request, res: Response): Promise<void> {
  const preguntas = await prisma.preguntaFrecuente.findMany({
    orderBy: { orden: "asc" },
  });

  res.status(200).json(preguntas);
}

/**
 * POST /api/preguntas-frecuentes
 * Admin: crea una pregunta frecuente nueva. Si no se manda "orden", se
 * calcula automáticamente como "el siguiente" (el mayor orden actual + 1,
 * o 0 si todavía no hay ninguna) para que la pregunta nueva aparezca al
 * final de la lista por defecto, sin que el admin tenga que calcularlo a
 * mano — mismo criterio que crearItemIncluido en itemIncluido.controller.ts.
 */
export async function crearPreguntaFrecuente(req: Request, res: Response): Promise<void> {
  const { pregunta, respuesta, orden } = req.body as Record<string, unknown>;

  if (typeof pregunta !== "string" || !pregunta.trim()) {
    res.status(400).json({ error: "El campo 'pregunta' es obligatorio y debe ser texto." });
    return;
  }

  if (typeof respuesta !== "string" || !respuesta.trim()) {
    res.status(400).json({ error: "El campo 'respuesta' es obligatorio y debe ser texto." });
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
    // "el siguiente": mayor orden actual + 1 (0 si es la primera pregunta).
    const ultimaPregunta = await prisma.preguntaFrecuente.findFirst({
      orderBy: { orden: "desc" },
    });
    ordenNumerico = ultimaPregunta ? ultimaPregunta.orden + 1 : 0;
  }

  const preguntaCreada = await prisma.preguntaFrecuente.create({
    data: { pregunta: pregunta.trim(), respuesta: respuesta.trim(), orden: ordenNumerico },
  });

  res.status(201).json(preguntaCreada);
}

/**
 * PUT /api/preguntas-frecuentes/:id
 * Admin: edita la pregunta y/o la respuesta de una pregunta frecuente ya
 * existente. Ambos campos son opcionales AQUÍ (a diferencia de crear): el
 * admin puede querer corregir solo la respuesta sin retocar la pregunta,
 * o viceversa, sin tener que reenviar el campo que no cambió. El "orden"
 * no se toca desde este endpoint — eso es responsabilidad exclusiva de
 * PATCH /api/preguntas-frecuentes/orden, mismo criterio que
 * actualizarItemIncluido en itemIncluido.controller.ts.
 */
export async function actualizarPreguntaFrecuente(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const { pregunta, respuesta } = req.body as Record<string, unknown>;

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "El id de la pregunta debe ser un número entero." });
    return;
  }

  if (pregunta === undefined && respuesta === undefined) {
    res.status(400).json({ error: "Debes mandar al menos uno de los campos 'pregunta' o 'respuesta'." });
    return;
  }

  if (pregunta !== undefined && (typeof pregunta !== "string" || !pregunta.trim())) {
    res.status(400).json({ error: "El campo 'pregunta', si se manda, debe ser texto no vacío." });
    return;
  }

  if (respuesta !== undefined && (typeof respuesta !== "string" || !respuesta.trim())) {
    res.status(400).json({ error: "El campo 'respuesta', si se manda, debe ser texto no vacío." });
    return;
  }

  try {
    const preguntaActualizada = await prisma.preguntaFrecuente.update({
      where: { id },
      data: {
        ...(pregunta !== undefined ? { pregunta: (pregunta as string).trim() } : {}),
        ...(respuesta !== undefined ? { respuesta: (respuesta as string).trim() } : {}),
      },
    });
    res.status(200).json(preguntaActualizada);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      res.status(404).json({ error: "Pregunta frecuente no encontrada." });
      return;
    }
    throw error;
  }
}

/**
 * DELETE /api/preguntas-frecuentes/:id
 * Admin: elimina una pregunta frecuente puntual. No afecta el "orden" de
 * las demás preguntas: pueden quedar números no consecutivos (ej. 0, 2, 3
 * tras borrar la que tenía "orden: 1"), lo cual no rompe nada — el
 * listado las ordena igual, solo importa su orden RELATIVO entre sí
 * (mismo criterio que eliminarItemIncluido).
 */
export async function eliminarPreguntaFrecuente(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "El id de la pregunta debe ser un número entero." });
    return;
  }

  try {
    await prisma.preguntaFrecuente.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      res.status(404).json({ error: "Pregunta frecuente no encontrada." });
      return;
    }
    throw error;
  }
}

// Forma esperada de cada entrada del array que recibe reordenarPreguntasFrecuentes.
interface OrdenPregunta {
  id: number;
  orden: number;
}

// Valida que el body sea un array de { id, orden } con ambos campos
// numéricos enteros. Idéntico criterio que validarArrayDeOrdenes en
// itemIncluido.controller.ts (no se comparte el código entre ambos
// archivos: es una validación de una sola función, más simple duplicarla
// que armar un módulo compartido solo para esto).
function validarArrayDeOrdenes(body: unknown): { error: string } | { items: OrdenPregunta[] } {
  if (!Array.isArray(body) || body.length === 0) {
    return { error: "El body debe ser un array no vacío de { id, orden }." };
  }

  const items: OrdenPregunta[] = [];
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
 * PATCH /api/preguntas-frecuentes/orden
 * Admin: actualiza el "orden" de varias preguntas de una sola vez (ej. al
 * arrastrar y soltar en la interfaz de admin). Body: [{ id, orden }, ...].
 *
 * Todo se aplica dentro de una transacción: si una sola pregunta fallara
 * (ej. no existe), NINGÚN cambio se guarda — mejor que dejar el
 * reordenamiento a medio aplicar, con unas preguntas ya movidas y otras
 * no. A diferencia de reordenarItemsIncluidos (que valida que los ids
 * pertenezcan a un equipo puntual), acá solo hace falta confirmar que
 * los ids existan: no hay ningún recurso padre del que puedan "no pertenecer".
 */
export async function reordenarPreguntasFrecuentes(req: Request, res: Response): Promise<void> {
  const resultadoValidacion = validarArrayDeOrdenes(req.body);
  if ("error" in resultadoValidacion) {
    res.status(400).json({ error: resultadoValidacion.error });
    return;
  }
  const { items } = resultadoValidacion;

  try {
    const preguntasActualizadas = await prisma.$transaction(async (tx) => {
      const idsExistentes = await tx.preguntaFrecuente.findMany({
        where: { id: { in: items.map((item) => item.id) } },
        select: { id: true },
      });
      if (idsExistentes.length !== items.length) {
        throw new Error("PREGUNTAS_NO_ENCONTRADAS");
      }

      return Promise.all(
        items.map((item) => tx.preguntaFrecuente.update({ where: { id: item.id }, data: { orden: item.orden } }))
      );
    });

    res.status(200).json(preguntasActualizadas);
  } catch (error) {
    if (error instanceof Error && error.message === "PREGUNTAS_NO_ENCONTRADAS") {
      res.status(400).json({ error: "Una o más preguntas del array no existen." });
      return;
    }
    throw error;
  }
}
