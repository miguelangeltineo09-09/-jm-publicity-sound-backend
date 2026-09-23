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
  ReservaNoConfirmadaError,
  ReservaNoEncontradaError,
  ReservaYaFacturadaError,
  crearFactura,
  generarPDFFactura,
} from "../services/factura.service";
import { EmailNoRegistradoError, EnvioCorreoError, enviarFacturaPorCorreo } from "../services/email.service";

/**
 * POST /api/facturas/:reservaId
 * Emite la factura de una reserva ya CONFIRMADA. Devuelve el registro de la
 * factura (todavía sin el PDF: eso se pide aparte con el siguiente endpoint).
 */
export async function emitirFactura(req: Request, res: Response): Promise<void> {
  const reservaId = Number(req.params.reservaId);

  if (!Number.isInteger(reservaId)) {
    res.status(400).json({ error: "El id de la reserva debe ser un número entero." });
    return;
  }

  try {
    const factura = await crearFactura(reservaId);
    res.status(201).json(factura);
  } catch (error) {
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
