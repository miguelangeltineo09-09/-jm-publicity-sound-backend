// ==========================================
// Controlador de Provincias.
// La lista de provincias es FIJA (32, cargadas por prisma/seed.ts): no
// existen POST ni DELETE. Listar es público (el formulario de reserva del
// frontend necesita el select de provincias); editar el precioViaje de una
// ya existente requiere admin autenticado (ver provincia.routes.ts).
// ==========================================

import type { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { Prisma } from "../generated/prisma/client";

/**
 * GET /api/provincias
 * Lista las 32 provincias, ordenadas alfabéticamente — el orden que
 * conviene para un <select> del formulario de reserva, no por id ni por
 * fecha de creación.
 */
export async function listarProvincias(_req: Request, res: Response): Promise<void> {
  const provincias = await prisma.provincia.findMany({
    orderBy: { nombre: "asc" },
  });

  res.status(200).json(provincias);
}

/**
 * PUT /api/provincias/:id
 * Admin: edita el precioViaje de una provincia existente. Es la ÚNICA
 * escritura permitida sobre Provincia — no se pueden crear ni eliminar
 * provincias desde la API, la lista completa ya la carga el seed.
 */
export async function actualizarPrecioViaje(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const { precioViaje } = req.body as { precioViaje?: unknown };

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "El id de la provincia debe ser un número entero." });
    return;
  }

  const precioViajeNumerico = Number(precioViaje);
  if (typeof precioViaje === "undefined" || Number.isNaN(precioViajeNumerico) || precioViajeNumerico < 0) {
    res.status(400).json({ error: "El campo 'precioViaje' es obligatorio y debe ser un número mayor o igual a 0." });
    return;
  }

  try {
    const provincia = await prisma.provincia.update({
      where: { id },
      data: { precioViaje: precioViajeNumerico },
    });
    res.status(200).json(provincia);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      res.status(404).json({ error: "Provincia no encontrada." });
      return;
    }
    throw error;
  }
}
