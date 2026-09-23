// ==========================================
// Servicio de Reseñas.
// Concentra la lógica de negocio (crear una reseña, calcular el promedio
// de calificación de un equipo, validación anti-spam), igual criterio que
// factura.service.ts/publicacion.service.ts: los fallos de negocio se
// señalan lanzando errores propios, para que resena.controller.ts los
// traduzca al código HTTP correcto con "instanceof", sin acoplar esta
// lógica a Express.
// ==========================================

import { prisma } from "../config/prisma";
import { EstadoResena } from "../generated/prisma/enums";
import type { ResenaModel } from "../generated/prisma/models";

// --- Errores de negocio propios ---
export class EquipoNoEncontradoError extends Error {}
export class ResenaDuplicadaError extends Error {}

// Ventana de tiempo (en minutos) dentro de la cual se bloquea un SEGUNDO
// envío del mismo nombreCliente para el mismo equipo. Es una validación
// anti-spam deliberadamente simple (no hay cuentas de usuario ni captcha
// en este proyecto): alcanza para frenar un doble clic accidental en el
// botón de enviar, o un intento básico de inflar/hundir la calificación
// de un equipo enviando el mismo formulario varias veces seguidas.
const MINUTOS_VENTANA_ANTISPAM = 5;

interface DatosCrearResena {
  equipoId: number;
  nombreCliente: string;
  calificacion: number;
  comentario?: string;
}

/**
 * Crea una reseña nueva. SIEMPRE nace en estado PENDIENTE — nunca es
 * visible públicamente ni cuenta para el promedio de un equipo hasta que
 * el admin la revisa y la aprueba (ver PATCH /api/resenas/:id/estado y
 * calcularPromedioCalificacion más abajo).
 *
 * Reglas de negocio:
 * 1. El equipo reseñado debe existir.
 * 2. Anti-spam: ese mismo nombreCliente no puede tener otra reseña de ese
 *    mismo equipo creada en los últimos MINUTOS_VENTANA_ANTISPAM minutos.
 */
export async function crearResena(datos: DatosCrearResena): Promise<ResenaModel> {
  const equipo = await prisma.equipo.findUnique({ where: { id: datos.equipoId } });
  if (!equipo) {
    throw new EquipoNoEncontradoError();
  }

  const desde = new Date(Date.now() - MINUTOS_VENTANA_ANTISPAM * 60 * 1000);
  const resenaReciente = await prisma.resena.findFirst({
    where: {
      equipoId: datos.equipoId,
      // "mode: insensitive" para que "Juan Pérez" y "juan pérez" cuenten
      // como el mismo cliente (no hay cuentas reales, solo texto libre).
      nombreCliente: { equals: datos.nombreCliente, mode: "insensitive" },
      createdAt: { gte: desde },
    },
  });
  if (resenaReciente) {
    throw new ResenaDuplicadaError();
  }

  return prisma.resena.create({
    data: {
      equipoId: datos.equipoId,
      nombreCliente: datos.nombreCliente,
      calificacion: datos.calificacion,
      comentario: datos.comentario,
      estado: EstadoResena.PENDIENTE,
    },
  });
}

/**
 * Calcula el promedio de calificación de un equipo y el total de reseñas
 * consideradas para ese promedio.
 *
 * Por qué SOLO cuenta reseñas APROBADA: las PENDIENTE todavía no fueron
 * revisadas por nadie (podrían ser spam, una calificación falsa, o
 * contenido inapropiado) y las RECHAZADA ya se descartaron a propósito —
 * si cualquiera de las dos entrara en el cálculo, el promedio dejaría de
 * representar reseñas reales y confiables, y perdería sentido tener
 * moderación en primer lugar.
 */
export async function calcularPromedioCalificacion(
  equipoId: number
): Promise<{ promedio: number; total: number }> {
  const resultado = await prisma.resena.aggregate({
    where: { equipoId, estado: EstadoResena.APROBADA },
    _avg: { calificacion: true },
    _count: true,
  });

  return {
    // _avg.calificacion es "null" (no 0) cuando todavía no hay ninguna
    // reseña aprobada — se traduce a 0 para no obligar al frontend a
    // manejar "null" como un caso especial.
    promedio: resultado._avg.calificacion === null ? 0 : Number(resultado._avg.calificacion.toFixed(2)),
    total: resultado._count,
  };
}
