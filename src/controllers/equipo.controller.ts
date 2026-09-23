// ==========================================
// Controlador de Equipos.
// Traduce las peticiones HTTP de /api/equipos a operaciones sobre Prisma,
// incluyendo la subida de imágenes a Cloudinary cuando corresponde.
// La lectura (listar/detalle) es pública; crear/editar/eliminar/cambiar
// disponibilidad requieren admin autenticado (ver equipo.routes.ts).
// ==========================================

import type { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { Prisma } from "../generated/prisma/client";
import type { EquipoUpdateInput, EquipoWhereInput } from "../generated/prisma/models";
import { EstadoReserva } from "../generated/prisma/enums";
import { subirImagen } from "../services/upload.service";

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
  precio?: Prisma.Decimal | number;
  categoriaId?: number;
  disponibleParaAlquiler?: boolean;
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
  if (body.precio !== undefined || !parcial) {
    const precioNumerico = Number(body.precio);
    if (typeof body.precio === "undefined" || Number.isNaN(precioNumerico) || precioNumerico <= 0) {
      return { error: "El campo 'precio' es obligatorio y debe ser un número mayor a 0." };
    }
    datos.precio = precioNumerico;
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

  return { datos };
}

/**
 * POST /api/equipos
 * Crea un equipo nuevo. Espera multipart/form-data: los campos del equipo
 * más, opcionalmente, un archivo "imagen" (ver multer en equipo.routes.ts).
 * Si viene imagen, se sube primero a Cloudinary y su URL se guarda en imagenUrl.
 */
export async function crearEquipo(req: Request, res: Response): Promise<void> {
  const resultado = await validarDatosEquipo(req.body, { parcial: false });

  if ("error" in resultado) {
    res.status(400).json({ error: resultado.error });
    return;
  }

  const { nombre, descripcion, precio, categoriaId, disponibleParaAlquiler } = resultado.datos;

  // La imagen es opcional al crear: un equipo puede darse de alta sin foto todavía.
  const imagenUrl = req.file ? await subirImagen(req.file.buffer) : null;

  const equipo = await prisma.equipo.create({
    data: {
      nombre: nombre!,
      descripcion: descripcion!,
      precio: precio!,
      categoriaId: categoriaId!,
      disponibleParaAlquiler: disponibleParaAlquiler ?? true,
      imagenUrl,
    },
    include: { categoria: true },
  });

  res.status(201).json(equipo);
}

/**
 * PUT /api/equipos/:id
 * Edita un equipo existente. Solo valida/actualiza los campos que llegaron
 * en el body (actualización parcial). Si llega un archivo nuevo, se sube a
 * Cloudinary y reemplaza la imagenUrl anterior (la imagen vieja no se borra
 * de Cloudinary: eso queda fuera del alcance de esta fase).
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

  const datosActualizados: EquipoUpdateInput = { ...resultado.datos };

  if (req.file) {
    datosActualizados.imagenUrl = await subirImagen(req.file.buffer);
  }

  try {
    const equipo = await prisma.equipo.update({
      where: { id },
      data: datosActualizados,
      include: { categoria: true },
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
