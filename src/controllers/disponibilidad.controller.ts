// ==========================================
// Controlador de Disponibilidad.
//
// Este endpoint es el que el frontend consulta para pintar el calendario de
// reserva: informa qué fechas están realmente bloqueadas. Una fecha se
// considera bloqueada si existe una reserva CONFIRMADA para ese día con
// CUALQUIERA de los equipos consultados (ver la regla de negocio detallada
// en reserva.controller.ts) — las reservas PENDIENTE o RECHAZADA no
// aparecen aquí, porque no ocupan la fecha.
//
// Por qué acepta varios equipos: ahora una reserva es un solo evento con
// VARIOS equipos elegidos (ver reserva.controller.ts), y todos comparten la
// misma fecha. Antes de confirmar la selección, el frontend necesita saber
// qué fechas quedan bloqueadas para la COMBINACIÓN completa: una fecha solo
// sirve si TODOS los equipos elegidos están libres ese día, así que hay que
// mostrar como ocupada cualquier fecha en la que AL MENOS UNO de ellos ya
// esté confirmado (la unión de las fechas ocupadas de cada equipo).
// ==========================================

import type { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { EstadoReserva } from "../generated/prisma/enums";

/**
 * Convierte el query param de equipos (que puede llegar como "equipoId=5"
 * o como "equipoIds=13,7,22") en una lista de números enteros válidos.
 * Devuelve null si el param no vino o si algún valor no es un entero.
 */
function parsearEquipoIds(req: Request): number[] | null {
  const { equipoId, equipoIds } = req.query;

  // Compatibilidad: si viene el singular "equipoId" (forma antigua de la
  // API, un equipo por reserva), se trata como una lista de un solo elemento.
  const valorCrudo = equipoIds !== undefined ? equipoIds : equipoId;
  if (valorCrudo === undefined || typeof valorCrudo !== "string" || valorCrudo.trim() === "") {
    return null;
  }

  const partes = valorCrudo.split(",").map((parte) => parte.trim());
  const numeros: number[] = [];
  for (const parte of partes) {
    const numero = Number(parte);
    if (!Number.isInteger(numero)) {
      return null;
    }
    numeros.push(numero);
  }

  return numeros;
}

/**
 * GET /api/disponibilidad?equipoIds=13,7,22  (o ?equipoId=5, forma antigua)
 * Devuelve la UNIÓN de las fechas (fechaEvento) de las reservas CONFIRMADAS
 * de todos los equipos indicados, sin duplicados, para que el frontend las
 * marque como no disponibles en el calendario de la combinación elegida.
 */
export async function obtenerDisponibilidad(req: Request, res: Response): Promise<void> {
  const equipoIds = parsearEquipoIds(req);

  if (equipoIds === null) {
    res.status(400).json({
      error:
        "Se requiere el query param 'equipoIds' (lista separada por comas, ej. '13,7,22') o 'equipoId' con un número entero.",
    });
    return;
  }

  // Se consulta a través de la tabla intermedia ReservaEquipo (ya no existe
  // Reserva.equipoId): una reserva "matchea" si tiene alguna fila cuyo
  // equipoId esté entre los pedidos.
  const reservasConfirmadas = await prisma.reserva.findMany({
    where: {
      estado: EstadoReserva.CONFIRMADA,
      equipos: { some: { equipoId: { in: equipoIds } } },
    },
    select: { fechaEvento: true },
    orderBy: { fechaEvento: "asc" },
  });

  // Dos equipos distintos podrían compartir una misma fechaEvento en
  // reservas diferentes (cada uno con la suya): se deduplica por el valor
  // ISO de la fecha para no repetir la misma fecha bloqueada dos veces.
  const fechasVistas = new Set<string>();
  const fechasBloqueadas = [];
  for (const reserva of reservasConfirmadas) {
    const clave = reserva.fechaEvento.toISOString();
    if (!fechasVistas.has(clave)) {
      fechasVistas.add(clave);
      fechasBloqueadas.push(reserva.fechaEvento);
    }
  }

  res.status(200).json(fechasBloqueadas);
}
