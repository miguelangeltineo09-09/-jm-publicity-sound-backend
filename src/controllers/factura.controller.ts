// ==========================================
// Controlador de Facturas.
// Traduce las peticiones HTTP de /api/facturas a llamadas a factura.service.ts.
// Todas las rutas son exclusivas del admin (ver factura.routes.ts).
// ==========================================

import type { Request, Response } from "express";
import { prisma } from "../config/prisma";
import type { FacturaWhereInput } from "../generated/prisma/models";
import {
  FacturaNoEncontradaError,
  PreciosManualesFaltantesError,
  ReservaNoConfirmadaError,
  ReservaNoEncontradaError,
  ReservaYaFacturadaError,
  crearFactura,
  generarPDFFactura,
} from "../services/factura.service";
import { EmailNoRegistradoError, EnvioCorreoError, enviarFacturaPorCorreo } from "../services/email.service";
import { MONTO_MAXIMO, MONTO_MINIMO, esMontoValido } from "../utils/precio";

// Lee y valida el campo opcional "preciosManuales" del body de
// POST /api/facturas/:reservaId, con la forma { "<equipoId>": <monto> } (ej.
// { "3": 50000 }): el monto que el admin fija a mano para los equipos cuyo
// precio NO es un número (ej. "Negociable en privado"). Aquí solo se valida
// la FORMA de lo que llegó; decidir para qué equipos hace falta lo hace
// crearFactura (ver factura.service.ts). Devuelve el error (para responder
// 400) o los montos ya convertidos a un Map de equipoId -> monto.
function leerPreciosManuales(body: unknown): { error: string } | { preciosManuales: Map<number, number> } {
  const preciosManuales = new Map<number, number>();

  // En Express 5, "req.body" es undefined si la petición no trae body (caso
  // normal cuando todos los equipos tienen precio numérico): no hay montos
  // manuales, y eso es válido. Lo mismo si el campo falta o viene en null.
  const crudo = (body as { preciosManuales?: unknown } | undefined)?.preciosManuales;
  if (crudo === undefined || crudo === null) {
    return { preciosManuales };
  }

  // Tiene que ser un objeto { "3": 50000 }: no un array, ni un texto, ni un número.
  if (typeof crudo !== "object" || Array.isArray(crudo)) {
    return { error: "El campo 'preciosManuales' debe ser un objeto con la forma { \"<equipoId>\": <monto> }." };
  }

  for (const [clave, monto] of Object.entries(crudo)) {
    // Las claves de un objeto JSON siempre llegan como texto: cada una debe
    // ser el id (entero positivo) de un equipo.
    if (!/^[1-9]\d*$/.test(clave)) {
      return { error: `La clave '${clave}' de 'preciosManuales' no es un id de equipo válido (debe ser un número entero).` };
    }

    // El monto debe ser un NÚMERO (no un texto como "50000") y un monto
    // válido, con la misma regla que el resto del sistema (ver esMontoValido).
    if (typeof monto !== "number" || !esMontoValido(monto)) {
      return {
        error: `El precio manual del equipo ${clave} debe ser un número entre ${MONTO_MINIMO} y ${MONTO_MAXIMO}.`,
      };
    }

    preciosManuales.set(Number(clave), monto);
  }

  return { preciosManuales };
}

/**
 * POST /api/facturas/:reservaId
 * Emite la factura de una reserva ya CONFIRMADA. Devuelve el registro de la
 * factura (todavía sin el PDF: eso se pide aparte con el siguiente endpoint).
 *
 * Body OPCIONAL: { "preciosManuales": { "<equipoId>": <monto> } }. Hace
 * falta solo cuando algún equipo de la reserva tiene un precio que no es un
 * número (ej. "Negociable en privado"): ahí se indica el monto a facturar
 * de cada uno. Si falta el monto de alguno, responde 400 diciendo cuáles
 * equipos son, y NO se crea ninguna factura (ver crearFactura).
 */
export async function emitirFactura(req: Request, res: Response): Promise<void> {
  const reservaId = Number(req.params.reservaId);

  if (!Number.isInteger(reservaId)) {
    res.status(400).json({ error: "El id de la reserva debe ser un número entero." });
    return;
  }

  const lectura = leerPreciosManuales(req.body);
  if ("error" in lectura) {
    res.status(400).json({ error: lectura.error });
    return;
  }

  try {
    const factura = await crearFactura(reservaId, lectura.preciosManuales);
    res.status(201).json(factura);
  } catch (error) {
    if (error instanceof PreciosManualesFaltantesError) {
      // Se nombra a cada equipo que falta (con su id y el precio actual en
      // texto) para que el admin sepa exactamente qué completar. La lista
      // también va aparte, estructurada, para que el frontend pueda pedir
      // los montos sin tener que "parsear" el mensaje (mismo criterio que
      // "equiposOcupados" en reserva.controller.ts).
      const detalle = error.equiposSinPrecio
        .map((equipo) => `"${equipo.nombre}" (id ${equipo.equipoId}, precio actual: "${equipo.precio}")`)
        .join(", ");
      res.status(400).json({
        error: `No se emitió la factura: falta indicar el precio manual de ${detalle}. Envíalo en el body como { "preciosManuales": { "<equipoId>": <monto> } }.`,
        equiposSinPrecio: error.equiposSinPrecio,
      });
      return;
    }
    if (error instanceof ReservaNoEncontradaError) {
      res.status(404).json({ error: "Reserva no encontrada." });
      return;
    }
    if (error instanceof ReservaNoConfirmadaError) {
      res.status(400).json({
        error: "Solo se pueden facturar reservas CONFIRMADAS. Confírmala antes de intentar facturarla.",
      });
      return;
    }
    if (error instanceof ReservaYaFacturadaError) {
      res.status(409).json({ error: "Esta reserva ya tiene una factura emitida." });
      return;
    }
    throw error;
  }
}

/**
 * GET /api/facturas/:facturaId/pdf
 * Genera el PDF de una factura ya emitida y lo devuelve directo en la
 * respuesta (Content-Type application/pdf), para que el navegador lo abra
 * o lo descargue sin pasos intermedios.
 */
export async function descargarFacturaPDF(req: Request, res: Response): Promise<void> {
  const facturaId = Number(req.params.facturaId);

  if (!Number.isInteger(facturaId)) {
    res.status(400).json({ error: "El id de la factura debe ser un número entero." });
    return;
  }

  try {
    const pdf = await generarPDFFactura(facturaId);

    res.setHeader("Content-Type", "application/pdf");
    // "inline" (no "attachment"): permite que el navegador lo muestre en
    // una pestaña si puede, sin forzar la descarga; el usuario igual puede
    // guardarlo desde ahí.
    res.setHeader("Content-Disposition", `inline; filename="factura-${facturaId}.pdf"`);
    res.status(200).send(pdf);
  } catch (error) {
    if (error instanceof FacturaNoEncontradaError) {
      res.status(404).json({ error: "Factura no encontrada." });
      return;
    }
    throw error;
  }
}

/**
 * POST /api/facturas/:facturaId/enviar
 * Envía por correo (con el PDF adjunto) una factura ya emitida al cliente
 * de la reserva correspondiente.
 */
export async function enviarFactura(req: Request, res: Response): Promise<void> {
  const facturaId = Number(req.params.facturaId);

  if (!Number.isInteger(facturaId)) {
    res.status(400).json({ error: "El id de la factura debe ser un número entero." });
    return;
  }

  try {
    const { enviadoA } = await enviarFacturaPorCorreo(facturaId);
    res.status(200).json({ mensaje: "Factura enviada correctamente.", enviadoA });
  } catch (error) {
    if (error instanceof FacturaNoEncontradaError) {
      res.status(404).json({ error: "Factura no encontrada." });
      return;
    }
    // A diferencia de EnvioCorreoError (más abajo), este caso no es un
    // fallo del servicio de correo: falta un dato necesario (el email de
    // la reserva) para poder cumplir la petición, así que responde 400,
    // no 502.
    if (error instanceof EmailNoRegistradoError) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (error instanceof EnvioCorreoError) {
      // Error de negocio ya traducido a un mensaje claro en email.service.ts
      // (nunca se expone el detalle crudo de la API de Resend).
      res.status(502).json({ error: error.message });
      return;
    }
    throw error;
  }
}

/**
 * GET /api/facturas
 * Lista todas las facturas, con la reserva y el equipo incluidos. Soporta
 * filtrar por ?reservaId= (por ahora, como la relación es uno a uno, esto
 * devuelve como mucho una factura, pero mantiene el mismo patrón de filtro
 * que ya usan equipos/reservas).
 */
export async function listarFacturas(req: Request, res: Response): Promise<void> {
  const { reservaId } = req.query;

  const where: FacturaWhereInput = {};

  if (reservaId !== undefined) {
    const reservaIdNumerico = Number(reservaId);
    if (!Number.isInteger(reservaIdNumerico)) {
      res.status(400).json({ error: "El query param 'reservaId' debe ser un número entero." });
      return;
    }
    where.reservaId = reservaIdNumerico;
  }

  // "reserva.equipo" ya no existe (una reserva ahora puede tener varios
  // equipos, ver ReservaEquipo en prisma/schema.prisma): se incluye la
  // lista completa de equipos de la reserva, y también "items" de la
  // propia factura (el desglose ya facturado, ver ItemFactura) para que
  // el panel de admin pueda mostrar el detalle sin otra llamada.
  const facturas = await prisma.factura.findMany({
    where,
    include: { reserva: { include: { equipos: { include: { equipo: true } } } }, items: true },
    orderBy: { createdAt: "desc" },
  });

  res.status(200).json(facturas);
}
