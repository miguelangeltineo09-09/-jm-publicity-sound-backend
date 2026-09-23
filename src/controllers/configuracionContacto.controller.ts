// ==========================================
// Controlador de Configuración de Contacto.
// SINGLETON (ver el comentario del modelo en schema.prisma): esta tabla
// siempre tiene exactamente una fila, sembrada por prisma/seed.ts. Por
// eso no existe un POST acá — solo GET (público, lo necesita el sitio
// para mostrar teléfono/horario/cobertura) y PUT (admin, edita esa única
// fila ya existente). Mismo criterio que provincia.controller.ts (una
// lista/fila fija, sin crear/eliminar desde la API), pero acotado a un
// solo registro en vez de 32.
// ==========================================

import type { Request, Response } from "express";
import { prisma } from "../config/prisma";

// Formato de email básico, mismo patrón que el resto del proyecto (ver
// reserva.controller.ts): alcanza para descartar strings claramente
// inválidos, sin intentar cubrir cada caso extremo de la spec de emails.
const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * GET /api/configuracion-contacto
 * Público: devuelve la única fila de configuración. "findFirst" (no
 * "findUnique" por un id fijo) porque a la API no le importa CUÁL sea el
 * id real de esa fila, solo que exista una — mismo espíritu que el resto
 * del singleton.
 */
export async function obtenerConfiguracionContacto(_req: Request, res: Response): Promise<void> {
  const configuracion = await prisma.configuracionContacto.findFirst();

  if (!configuracion) {
    // No debería pasar en un entorno donde ya se corrió el seed, pero se
    // responde con un mensaje claro en vez de un 200 con "null" o un 500
    // crudo si por algún motivo la fila todavía no existe.
    res.status(404).json({
      error: "Todavía no hay una configuración de contacto cargada. Corre el seed del backend.",
    });
    return;
  }

  res.status(200).json(configuracion);
}

/**
 * PUT /api/configuracion-contacto
 * Admin: edita la única fila de configuración. Los cuatro campos son
 * OPCIONALES en el body — solo se actualiza lo que venga, para que el
 * admin pueda cambiar, por ejemplo, solo el horario sin tener que
 * reenviar el teléfono/email/mensaje de cobertura tal como estaban.
 */
export async function actualizarConfiguracionContacto(req: Request, res: Response): Promise<void> {
  const { telefono, email, horarioAtencion, mensajeCobertura } = req.body as Record<string, unknown>;

  if (telefono !== undefined && (typeof telefono !== "string" || !telefono.trim())) {
    res.status(400).json({ error: "El campo 'telefono', si se manda, debe ser texto no vacío." });
    return;
  }

  // "email" es el único campo que puede vaciarse a propósito (ver el
  // comentario en schema.prisma: sigue sin dominio propio por ahora):
  // null o "" lo dejan en null; un string no vacío debe tener forma de
  // email válido.
  let emailNormalizado: string | null | undefined;
  if (email === undefined) {
    emailNormalizado = undefined;
  } else if (email === null || (typeof email === "string" && email.trim() === "")) {
    emailNormalizado = null;
  } else if (typeof email === "string" && FORMATO_EMAIL.test(email.trim())) {
    emailNormalizado = email.trim();
  } else {
    res.status(400).json({ error: "El campo 'email', si se manda, debe tener un formato de email válido." });
    return;
  }

  if (horarioAtencion !== undefined && (typeof horarioAtencion !== "string" || !horarioAtencion.trim())) {
    res.status(400).json({ error: "El campo 'horarioAtencion', si se manda, debe ser texto no vacío." });
    return;
  }

  if (mensajeCobertura !== undefined && (typeof mensajeCobertura !== "string" || !mensajeCobertura.trim())) {
    res.status(400).json({ error: "El campo 'mensajeCobertura', si se manda, debe ser texto no vacío." });
    return;
  }

  const configuracionActual = await prisma.configuracionContacto.findFirst();
  if (!configuracionActual) {
    res.status(404).json({
      error: "Todavía no hay una configuración de contacto cargada. Corre el seed del backend.",
    });
    return;
  }

  const configuracionActualizada = await prisma.configuracionContacto.update({
    where: { id: configuracionActual.id },
    data: {
      ...(telefono !== undefined ? { telefono: (telefono as string).trim() } : {}),
      ...(emailNormalizado !== undefined ? { email: emailNormalizado } : {}),
      ...(horarioAtencion !== undefined ? { horarioAtencion: (horarioAtencion as string).trim() } : {}),
      ...(mensajeCobertura !== undefined ? { mensajeCobertura: (mensajeCobertura as string).trim() } : {}),
    },
  });

  res.status(200).json(configuracionActualizada);
}
