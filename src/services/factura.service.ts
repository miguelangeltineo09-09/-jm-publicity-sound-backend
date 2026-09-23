// ==========================================
// Servicio de Facturas.
//
// Igual que auth.service.ts: concentra la lógica de negocio y el acceso a
// datos (Prisma, generación del PDF), mientras que factura.controller.ts
// solo traduce HTTP <-> estas funciones. Las validaciones de negocio se
// señalan lanzando errores propios (no devolviendo null/booleanos), para
// que el controlador los distinga con "instanceof" y elija el código HTTP
// correcto (404/400/409), sin acoplar esta lógica a Express.
// ==========================================

import PDFDocument from "pdfkit";
import { prisma } from "../config/prisma";
import { EstadoReserva } from "../generated/prisma/enums";
import type { FacturaModel, ItemFacturaModel, ReservaModel } from "../generated/prisma/models";

// --- Errores de negocio propios ---
export class ReservaNoEncontradaError extends Error {}
export class ReservaNoConfirmadaError extends Error {}
export class ReservaYaFacturadaError extends Error {}
export class FacturaNoEncontradaError extends Error {}

// Datos genéricos del negocio para el encabezado del PDF. El backend no
// tiene todavía una tabla de "configuración del negocio": se usan los
// mismos placeholders que ya existen en el footer del sitio público
// (src/components/Footer.tsx del frontend), para que la factura muestre
// datos de contacto consistentes con el resto del proyecto.
const NOMBRE_NEGOCIO = "JM Publicity Sound";
const TELEFONO_NEGOCIO = "+52 55 0000 0000";
const EMAIL_NEGOCIO = "contacto@jmpublicitysound.com";

// Cantidad mínima de dígitos del número secuencial ("FAC-0001", no "FAC-1").
const DIGITOS_NUMERO_FACTURA = 4;

/**
 * Genera el siguiente número de factura secuencial ("FAC-0001", "FAC-0002", ...).
 * Se basa en la última factura CREADA (por id descendente, no por
 * numeroFactura como texto, para no depender del padding al ordenar).
 */
export async function generarNumeroFactura(): Promise<string> {
  const ultima = await prisma.factura.findFirst({ orderBy: { id: "desc" } });

  // Se extrae el número de la última factura para continuar la secuencia;
  // si por algún motivo no calza con el formato esperado (no debería pasar,
  // ya que este mismo servicio es el único que crea facturas), se asume 0
  // en vez de romper la generación de la siguiente.
  const ultimoNumero = ultima ? Number(ultima.numeroFactura.match(/(\d+)$/)?.[0] ?? 0) : 0;
  const siguiente = ultimoNumero + 1;

  return `FAC-${String(siguiente).padStart(DIGITOS_NUMERO_FACTURA, "0")}`;
}

/**
 * Crea la factura de una reserva.
 *
 * Reglas de negocio:
 * 1. La reserva debe existir.
 * 2. Solo se factura una reserva CONFIRMADA (no tiene sentido facturar algo
 *    que todavía no se aprobó, o que se rechazó).
 * 3. Cada reserva se factura una sola vez (relación uno a uno con Factura).
 *
 * Antes una reserva tenía un solo equipo, así que la factura guardaba
 * "equipoNombre"/"precioUnitario" directo en sus propias columnas. Ahora
 * una reserva puede tener VARIOS equipos (ver ReservaEquipo en
 * prisma/schema.prisma), así que cada equipo se factura como su propia
 * fila en ItemFactura (uno a muchos) — mismo criterio de snapshot que
 * antes (ver el comentario en prisma/schema.prisma): el nombre y precio de
 * cada equipo, y el precioViaje de la provincia, se copian tal como están
 * AHORA, al momento de facturar, y quedan fijos en la factura aunque el
 * equipo cambie de precio o el admin edite después el precioViaje de esa
 * provincia.
 *
 * El precio de cada equipo NO incluye viaje ni dieta (ver el comentario
 * del modelo Provincia): el total a cobrar es la suma de todos los
 * ItemFactura más ese único cargo de viaje (el viaje es por evento, no se
 * multiplica por la cantidad de equipos).
 */
export async function crearFactura(reservaId: number): Promise<FacturaModel> {
  const reserva = await prisma.reserva.findUnique({
    where: { id: reservaId },
    include: { equipos: { include: { equipo: true } }, provincia: true, factura: true },
  });

  if (!reserva) {
    throw new ReservaNoEncontradaError();
  }

  if (reserva.estado !== EstadoReserva.CONFIRMADA) {
    throw new ReservaNoConfirmadaError();
  }

  if (reserva.factura) {
    throw new ReservaYaFacturadaError();
  }

  const numeroFactura = await generarNumeroFactura();

  // Se suma como number (no con la aritmética de Prisma.Decimal): los
  // valores ya vienen fijos a 2 decimales desde sus columnas Decimal(10,2)
  // en la base de datos, y la columna "total" (también Decimal(10,2)) va a
  // redondear el resultado a 2 decimales igual al guardarlo, así que no hay
  // riesgo real de un error de redondeo de punto flotante acá.
  const itemsFactura = reserva.equipos.map((reservaEquipo) => ({
    equipoNombre: reservaEquipo.equipo.nombre,
    precioUnitario: Number(reservaEquipo.equipo.precio),
  }));
  const precioViaje = Number(reserva.provincia.precioViaje);
  const totalEquipos = itemsFactura.reduce((suma, item) => suma + item.precioUnitario, 0);

  return prisma.factura.create({
    data: {
      numeroFactura,
      reservaId: reserva.id,
      items: { create: itemsFactura },
      precioViajeSnapshot: precioViaje,
      total: totalEquipos + precioViaje,
    },
  });
}

// Dado cualquier Date, devuelve "DD/MM/AAAA" usando sus componentes en UTC
// (no en la hora local del servidor). Igual que en reserva.controller.ts:
// fechaEvento representa un día calendario fijo sin importar la zona
// horaria, así que hay que leerlo con los getters UTC para no correr el
// día un día para atrás/adelante según dónde corra el proceso.
export function formatearFechaUTC(fecha: Date): string {
  const dia = String(fecha.getUTCDate()).padStart(2, "0");
  const mes = String(fecha.getUTCMonth() + 1).padStart(2, "0");
  const anio = fecha.getUTCFullYear();
  return `${dia}/${mes}/${anio}`;
}

// Formatea un Decimal/number de Prisma como moneda de República
// Dominicana: prefijo "RD$", coma como separador de miles, SIN decimales
// (se redondea si el valor trae centavos) — ej. "RD$45,000". Antes usaba
// "es-MX" con 2 decimales fijos ("$45,000.00"), que no es como se muestra
// el dinero en RD; debe coincidir con formatearMoneda() del frontend
// (src/lib/formato.ts) para que la factura en PDF se vea igual que el
// resto del sitio.
function formatearMoneda(valor: unknown): string {
  const numero = Math.round(Number(valor));
  return `RD$${numero.toLocaleString("en-US")}`;
}

// Imprime una fila de dos columnas alineadas (usado para armar la "tabla"
// de cobro sin depender de la API de tablas de pdfkit, más simple para un
// layout de una sola fila de datos).
function filaDeDosColumnas(
  doc: PDFKit.PDFDocument,
  columnaIzquierda: string,
  columnaDerecha: string,
  xIzquierda: number,
  xDerecha: number,
  y: number
): void {
  doc.text(columnaIzquierda, xIzquierda, y);
  doc.text(columnaDerecha, xDerecha, y, { width: 150, align: "right" });
}

/**
 * Genera el PDF de una factura ya creada y lo devuelve como Buffer en
 * memoria (no se escribe a disco: se arma todo en RAM y se junta al
 * terminar, para poder devolverlo directo como respuesta HTTP).
 */
export async function generarPDFFactura(facturaId: number): Promise<Buffer> {
  const factura = await prisma.factura.findUnique({
    where: { id: facturaId },
    include: { reserva: true, items: true },
  });

  if (!factura) {
    throw new FacturaNoEncontradaError();
  }

  return construirPDF(factura);
}

// Se recibe la factura ya con su reserva e items incluidos (tipo inferido
// de la consulta de arriba); se define acá en vez de como parámetro
// separado para no tener que nombrar a mano el tipo combinado. "items" es
// la lista de equipos facturados (antes era un solo equipoNombre/precioUnitario
// directo en la factura, ver el comentario de crearFactura más arriba).
function construirPDF(factura: FacturaModel & { reserva: ReservaModel; items: ItemFacturaModel[] }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });

    // pdfkit emite el PDF como stream: se van juntando los pedacitos
    // (chunks) en memoria y, al terminar ("end"), se concatenan en un
    // único Buffer — así nunca se toca el disco.
    const partes: Buffer[] = [];
    doc.on("data", (chunk) => partes.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(partes)));
    doc.on("error", reject);

    // --- Encabezado: nombre del negocio y contacto ---
    doc.fontSize(20).font("Helvetica-Bold").text(NOMBRE_NEGOCIO);
    doc
      .fontSize(10)
      .font("Helvetica")
      .fillColor("#555555")
      .text(`Tel: ${TELEFONO_NEGOCIO}`)
      .text(`Email: ${EMAIL_NEGOCIO}`)
      .fillColor("#000000");
    doc.moveDown(1.5);

    // --- Número de factura y fecha de emisión ---
    doc.fontSize(16).font("Helvetica-Bold").text(`Factura ${factura.numeroFactura}`);
    doc
      .fontSize(10)
      .font("Helvetica")
      .text(`Fecha de emisión: ${formatearFechaUTC(factura.fechaEmision)}`);
    doc.moveDown(1);

    // --- Datos del cliente ---
    // "clienteEmail" puede ser null (reserva creada a mano por el admin
    // sin ese dato, ver reserva.controller.ts): se imprime "No
    // registrado" en vez de dejar que aparezca el texto literal "null"
    // en un documento real.
    doc.fontSize(12).font("Helvetica-Bold").text("Datos del cliente");
    doc
      .fontSize(10)
      .font("Helvetica")
      .text(`Nombre: ${factura.reserva.clienteNombre}`)
      .text(`Teléfono: ${factura.reserva.clienteTelefono}`)
      .text(`Email: ${factura.reserva.clienteEmail ?? "No registrado"}`);
    doc.moveDown(1);

    // --- Detalle del evento (para que el negocio sepa qué se entregó y cuándo) ---
    // "items" puede tener varios equipos (antes siempre era uno solo): se
    // listan los nombres separados por coma en esta sección resumen; el
    // desglose con precio de cada uno va en la tabla de cobro más abajo.
    const nombresEquipos = factura.items.map((item) => item.equipoNombre).join(", ");
    doc.fontSize(12).font("Helvetica-Bold").text("Detalle del evento");
    doc
      .fontSize(10)
      .font("Helvetica")
      .text(`Equipo(s): ${nombresEquipos}`)
      .text(`Fecha del evento: ${formatearFechaUTC(factura.reserva.fechaEvento)}`)
      .text(`Horario: ${factura.reserva.horaInicio} a ${factura.reserva.horaFin}`);
    doc.moveDown(1);

    // --- Tabla de cobro: una fila por cada equipo (ItemFactura) + una fila
    // de viaje/dieta, dos columnas fijas — antes solo había un equipo, ahora
    // se desglosan TODOS para que el cliente vea de dónde sale cada monto
    // (el precio de cada equipo NO incluye viaje ni dieta). ---
    const xIzquierda = doc.page.margins.left;
    const xDerecha = doc.page.width - doc.page.margins.right - 150;

    doc.fontSize(12).font("Helvetica-Bold").text("Detalle de cobro");
    doc.moveDown(0.5);

    let y = doc.y;
    doc.fontSize(10).font("Helvetica-Bold");
    filaDeDosColumnas(doc, "Concepto", "Precio", xIzquierda, xDerecha, y);
    doc.moveDown(0.5);

    doc.font("Helvetica");
    for (const item of factura.items) {
      y = doc.y;
      filaDeDosColumnas(doc, item.equipoNombre, formatearMoneda(item.precioUnitario), xIzquierda, xDerecha, y);
      doc.moveDown(0.5);
    }

    // "Viaje y dieta": un solo monto por evento, no por equipo (ver el
    // comentario del modelo Provincia — precioViaje ya incluye la dieta,
    // no son dos conceptos).
    y = doc.y;
    filaDeDosColumnas(
      doc,
      "Viaje y dieta",
      formatearMoneda(factura.precioViajeSnapshot),
      xIzquierda,
      xDerecha,
      y
    );
    doc.moveDown(1);

    // Línea separadora antes del total, para distinguirlo visualmente del detalle.
    doc
      .moveTo(xIzquierda, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .strokeColor("#cccccc")
      .stroke();
    doc.moveDown(0.5);

    // --- Total a pagar, destacado ---
    doc
      .fontSize(14)
      .font("Helvetica-Bold")
      .text(`Total a pagar: ${formatearMoneda(factura.total)}`, { align: "right" });
    doc.moveDown(3);

    // --- Nota al pie: aclara que esto no es un comprobante fiscal formal ---
    doc
      .fontSize(8)
      .font("Helvetica-Oblique")
      .fillColor("#888888")
      .text("Este documento es un comprobante interno, no tiene validez fiscal.", { align: "center" });

    doc.end();
  });
}
