// ==========================================
// Servicio de Configuración de Contacto.
//
// Punto ÚNICO desde el que el backend LEE los datos de contacto REALES del
// negocio (la tabla ConfiguracionContacto, la que el admin edita desde el
// panel) para imprimirlos en sus propios documentos: el encabezado del PDF
// de la factura (factura.service.ts) y el pie del correo que lo acompaña
// (email.service.ts).
//
// Vive en su propio archivo, y no dentro de uno de esos dos servicios, para
// que ambos apliquen exactamente la misma regla (qué se considera "sin
// valor" y cómo se normaliza el texto) sin copiar código, y para que el
// servicio de correo no tenga que pedirle datos del negocio al servicio de
// facturas.
//
// El controlador configuracionContacto.controller.ts sigue accediendo a la
// tabla por su cuenta: él devuelve y edita la fila COMPLETA (horario,
// mensaje de cobertura, etc.), mientras que este servicio solo expone lo que
// se imprime en los documentos.
// ==========================================

import { prisma } from "../config/prisma";

// Datos de contacto del negocio listos para imprimir. Cada campo es null
// cuando no hay un valor utilizable (nunca un texto vacío), para que quien
// arma el documento pueda omitir esa línea en vez de imprimirla vacía o con
// el texto literal "null".
export interface ContactoNegocio {
  telefono: string | null;
  email: string | null;
}

// Recorta los espacios de un texto opcional y trata un texto vacío (o solo
// con espacios) igual que la ausencia de valor (null).
function textoOpcional(valor: string | null | undefined): string | null {
  const recortado = valor?.trim();
  return recortado ? recortado : null;
}

/**
 * Lee de la base de datos los datos de contacto REALES del negocio: la
 * tabla ConfiguracionContacto, la misma que edita el admin desde el panel y
 * que devuelve GET /api/configuracion-contacto (ver
 * configuracionContacto.controller.ts). Se usa "findFirst" igual que allá:
 * es una tabla de una sola fila (singleton) y no importa cuál sea su id.
 *
 * Los valores se leen cada vez que se llama (no se guardan en memoria ni en
 * la factura): si el admin cambia el teléfono o el email desde el panel, el
 * siguiente PDF o correo que se genere ya sale con el dato nuevo.
 *
 * Si la fila todavía no existe (no debería pasar en un entorno donde ya se
 * corrió el seed), NO se lanza ningún error: se devuelven ambos datos en
 * null y el documento se genera igual, solo sin líneas de contacto. Una
 * factura o un correo no deben fallar por no poder imprimir un teléfono.
 */
export async function obtenerContactoNegocio(): Promise<ContactoNegocio> {
  const configuracion = await prisma.configuracionContacto.findFirst();

  return {
    telefono: textoOpcional(configuracion?.telefono),
    email: textoOpcional(configuracion?.email),
  };
}
