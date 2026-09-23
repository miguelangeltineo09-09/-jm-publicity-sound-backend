// ==========================================
// Servicio de envío de correo.
// Envía la factura en PDF al cliente de una reserva, usando Resend. No
// duplica lógica ya existente: reutiliza generarPDFFactura() (el PDF) y los
// errores/formateo ya definidos en factura.service.ts.
// ==========================================

import { resend } from "../config/resend";
import { prisma } from "../config/prisma";
import { FacturaNoEncontradaError, formatearFechaUTC, generarPDFFactura } from "./factura.service";

// Mismos datos de contacto genéricos usados en el PDF de la factura
// (ver factura.service.ts) y en el footer del sitio público, para que el
// correo se vea consistente con el resto de las comunicaciones del negocio.
const TELEFONO_NEGOCIO = "+52 55 0000 0000";
const EMAIL_NEGOCIO = "contacto@jmpublicitysound.com";

// Remitente del correo. IMPORTANTE: en el plan gratis de Resend, mientras
// no se verifique un dominio propio (https://resend.com/domains), solo se
// puede enviar desde la dirección de prueba de Resend
// ("onboarding@resend.dev"), y ÚNICAMENTE al correo con el que te
// registraste en Resend — cualquier otro destinatario será rechazado. Se
// deja configurable por variable de entorno para no tocar código el día
// que se verifique un dominio propio (ver .env.example).
const REMITENTE = process.env.RESEND_FROM_EMAIL || "JM Publicity Sound <onboarding@resend.dev>";

// Error propio para el envío de correo, análogo a los de factura.service.ts:
// el mensaje ya viene "limpio" (sin detalles internos de la API de Resend),
// listo para mostrarse al admin desde el controlador.
export class EnvioCorreoError extends Error {}

// Error propio y distinto de EnvioCorreoError: este NO es un fallo de
// Resend (nunca se llega a intentar el envío), es que la reserva de esta
// factura no tiene clienteEmail (nace null cuando la crea el admin desde
// POST /api/reservas/admin sin ese dato, ver reserva.controller.ts). Se
// separa del error de Resend para que el controlador pueda responder un
// código HTTP distinto (400: falta un dato para poder cumplir la
// petición, no 502 que es "el servicio de correo falló").
export class EmailNoRegistradoError extends Error {}

/**
 * Traduce el error que devuelve Resend a un mensaje claro y seguro de
 * mostrar. El detalle crudo de Resend NUNCA se expone al cliente HTTP
 * (podría incluir información interna de la cuenta/API); en cambio, se
 * registra completo en consola para poder diagnosticar el problema real.
 */
function mensajeDeErrorResend(errorResend: { name: string; message: string }): string {
  const { name: nombreError, message: mensajeOriginal } = errorResend;

  // Caso puntual y muy común mientras no haya un dominio verificado (ver
  // el aviso en .env.example): Resend NO usa un código de error propio
  // para "destinatario no permitido" — lo reporta como "validation_error"
  // genérico. Se detecta por el texto del mensaje para poder avisar la
  // causa real (en vez de un genérico "datos inválidos") sin repetir el
  // texto interno de Resend tal cual.
  if (nombreError === "validation_error" && /testing email address|`to`/i.test(mensajeOriginal)) {
    return "El destinatario no está permitido: sin un dominio verificado en Resend, solo se puede enviar al correo con el que te registraste en Resend (ver RESEND_FROM_EMAIL en .env.example).";
  }

  switch (nombreError) {
    case "invalid_api_key":
    case "missing_api_key":
    case "restricted_api_key":
      return "No se pudo autenticar con el servicio de correo. Revisa la configuración de RESEND_API_KEY.";
    case "invalid_from_address":
      return "El remitente configurado no está autorizado en Resend (dominio no verificado).";
    case "validation_error":
    case "invalid_parameter":
    case "missing_required_field":
    case "invalid_attachment":
      return "Los datos del correo no son válidos.";
    case "rate_limit_exceeded":
    case "monthly_quota_exceeded":
    case "daily_quota_exceeded":
      return "Se alcanzó el límite de envíos del servicio de correo. Intenta más tarde.";
    default:
      return "No se pudo enviar el correo. Intenta de nuevo más tarde.";
  }
}

// Cuerpo HTML del correo: saludo, contexto de la reserva (qué se
// facturó y para cuándo), aviso del adjunto, y datos de contacto para
// dudas. Se mantiene simple e inline (sin CSS externo) porque los clientes
// de correo no lo soportan de forma confiable.
function construirHtmlCorreo(params: {
  clienteNombre: string;
  numeroFactura: string;
  equiposNombres: string[];
  fechaEvento: Date;
}): string {
  const { clienteNombre, numeroFactura, equiposNombres, fechaEvento } = params;
  // Antes una reserva/factura tenía un solo equipo; ahora puede tener
  // varios (ver ItemFactura en prisma/schema.prisma), así que se listan
  // todos los nombres separados por coma en el cuerpo del correo.
  const nombresEquipos = equiposNombres.join(", ");

  return `
    <div style="font-family: Arial, sans-serif; color: #222; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #0891b2;">JM Publicity Sound</h2>
      <p>Hola ${clienteNombre},</p>
      <p>
        Adjuntamos la factura <strong>${numeroFactura}</strong> correspondiente a la
        reserva de <strong>${nombresEquipos}</strong> para el evento del
        <strong>${formatearFechaUTC(fechaEvento)}</strong>.
      </p>
      <p>El comprobante está adjunto a este correo en formato PDF.</p>
      <p>Si tienes cualquier duda sobre tu factura o tu reserva, puedes contactarnos:</p>
      <p>
        Tel: ${TELEFONO_NEGOCIO}<br />
        Email: ${EMAIL_NEGOCIO}
      </p>
      <p style="color: #888; font-size: 12px;">JM Publicity Sound — Alquiler de equipos de sonido para eventos.</p>
    </div>
  `;
}

/**
 * Envía por correo la factura ya emitida de una reserva, con el PDF
 * adjunto, al clienteEmail de esa reserva.
 *
 * Pasos:
 * 1. Buscar la factura con su reserva (para el email/nombre del cliente,
 *    el nombre del equipo y la fecha del evento del cuerpo del correo).
 * 2. Generar el PDF reutilizando generarPDFFactura() — no se rearma el
 *    documento acá, se llama a la función ya existente.
 * 3. Enviar el correo con Resend, con el PDF como adjunto.
 * 4. Traducir cualquier error de Resend a un mensaje claro (ver
 *    mensajeDeErrorResend), sin dejar pasar detalles internos.
 */
export async function enviarFacturaPorCorreo(facturaId: number): Promise<{ enviadoA: string }> {
  const factura = await prisma.factura.findUnique({
    where: { id: facturaId },
    include: { reserva: true, items: true },
  });

  if (!factura) {
    throw new FacturaNoEncontradaError();
  }

  // Se revisa ANTES de generar el PDF (que es lo más costoso de este
  // flujo): si esta reserva no tiene email, no tiene sentido armar el PDF
  // para nada, y el mensaje de error queda claro en vez de que la llamada
  // a Resend falle de forma confusa con "to" vacío/inválido.
  const { clienteEmail } = factura.reserva;
  if (!clienteEmail) {
    throw new EmailNoRegistradoError(
      "Esta reserva no tiene email registrado, no se puede enviar la factura por correo."
    );
  }

  // "clienteEmail" se guarda en esta variable local (en vez de leerlo de
  // nuevo desde "factura.reserva.clienteEmail" más abajo) para que
  // TypeScript conserve que ya no es null: ese chequeo quedaría "perdido"
  // después del "await" de generarPDFFactura si se volviera a leer desde
  // la propiedad del objeto en vez de esta constante ya angosta.
  const pdf = await generarPDFFactura(facturaId);

  const { clienteNombre } = factura.reserva;
  const nombreArchivo = `factura-${factura.numeroFactura}.pdf`;

  let resultado;
  try {
    resultado = await resend.emails.send({
      from: REMITENTE,
      to: clienteEmail,
      subject: `Tu factura de JM Publicity Sound - ${factura.numeroFactura}`,
      html: construirHtmlCorreo({
        clienteNombre,
        numeroFactura: factura.numeroFactura,
        equiposNombres: factura.items.map((item) => item.equipoNombre),
        fechaEvento: factura.reserva.fechaEvento,
      }),
      attachments: [{ filename: nombreArchivo, content: pdf }],
    });
  } catch (error) {
    // Fallo de red/conexión con la API de Resend (no un error de negocio
    // que Resend haya devuelto de forma controlada).
    console.error("Error de red al enviar el correo con Resend:", error);
    throw new EnvioCorreoError("No se pudo conectar con el servicio de correo. Intenta de nuevo más tarde.");
  }

  if (resultado.error) {
    console.error("Resend devolvió un error al enviar la factura:", resultado.error);
    throw new EnvioCorreoError(mensajeDeErrorResend(resultado.error));
  }

  return { enviadoA: clienteEmail };
}
