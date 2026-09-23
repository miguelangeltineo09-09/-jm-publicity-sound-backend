// ==========================================
// Controlador de Categorías.
// Traduce las peticiones HTTP de /api/categorias a operaciones sobre Prisma.
// La lectura (listar) es pública; crear/editar/eliminar requieren estar
// autenticado (ver auth.middleware en categoria.routes.ts).
// ==========================================

import type { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { Prisma } from "../generated/prisma/client";

/**
 * GET /api/categorias
 * Lista todas las categorías. No requiere autenticación: el catálogo
 * público del frontend necesita esta lista para armar los filtros.
 */
export async function listarCategorias(_req: Request, res: Response): Promise<void> {
  const categorias = await prisma.categoria.findMany({
    orderBy: { nombre: "asc" },
  });

  res.status(200).json(categorias);
}

/**
 * POST /api/categorias
 * Crea una categoría nueva.
 * Validación: "nombre" es obligatorio y debe ser un string no vacío.
 * El nombre duplicado se rechaza con 400 (en vez de dejar que la BD
 * devuelva un error 500 crudo por la restricción @unique).
 */
export async function crearCategoria(req: Request, res: Response): Promise<void> {
  const { nombre } = req.body as { nombre?: unknown };

  if (typeof nombre !== "string" || !nombre.trim()) {
    res.status(400).json({ error: "El campo 'nombre' es obligatorio y debe ser texto." });
    return;
  }

  try {
    const categoria = await prisma.categoria.create({
      data: { nombre: nombre.trim() },
    });
    res.status(201).json(categoria);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      res.status(400).json({ error: "Ya existe una categoría con ese nombre." });
      return;
    }
    throw error;
  }
}

/**
 * PUT /api/categorias/:id
 * Edita el nombre de una categoría existente.
 */
export async function actualizarCategoria(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const { nombre } = req.body as { nombre?: unknown };

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "El id de la categoría debe ser un número entero." });
    return;
  }

  if (typeof nombre !== "string" || !nombre.trim()) {
    res.status(400).json({ error: "El campo 'nombre' es obligatorio y debe ser texto." });
    return;
  }

  try {
    const categoria = await prisma.categoria.update({
      where: { id },
      data: { nombre: nombre.trim() },
    });
    res.status(200).json(categoria);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        res.status(404).json({ error: "Categoría no encontrada." });
        return;
      }
      if (error.code === "P2002") {
        res.status(400).json({ error: "Ya existe una categoría con ese nombre." });
        return;
      }
    }
    throw error;
  }
}

/**
 * DELETE /api/categorias/:id
 * Elimina una categoría, pero solo si no tiene equipos asociados: borrarla
 * de todas formas dejaría equipos "huérfanos" o rotos en el catálogo, así
 * que se verifica antes y se responde con un mensaje claro en vez de un
 * error de restricción de base de datos.
 */
export async function eliminarCategoria(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "El id de la categoría debe ser un número entero." });
    return;
  }

  const cantidadEquipos = await prisma.equipo.count({ where: { categoriaId: id } });

  if (cantidadEquipos > 0) {
    res.status(400).json({
      error: `No se puede eliminar la categoría: tiene ${cantidadEquipos} equipo(s) asociado(s). Reasigna o elimina esos equipos primero.`,
    });
    return;
  }

  try {
    await prisma.categoria.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      res.status(404).json({ error: "Categoría no encontrada." });
      return;
    }
    throw error;
  }
}
