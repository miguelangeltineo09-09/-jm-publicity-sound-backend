// ==========================================
// Utilidades para trabajar con el precio de los equipos.
//
// "Equipo.precio" es TEXTO LIBRE (ver el modelo Equipo en
// prisma/schema.prisma): puede ser un número escrito como texto (ej.
// "45000") o una frase (ej. "Negociable en privado", "Precio a consultar").
// Por eso NINGÚN cálculo del sistema debe hacer Number(equipo.precio)
// directo: una frase daría NaN, y un texto que solo EMPIEZA con un número
// (ej. "3 horas por 5000") se leería como 3 con un parseFloat a secas.
//
// Todo lugar donde el sistema necesite sumar o calcular con el precio de un
// equipo (hoy, la facturación en factura.service.ts) debe pasar por
// parsearPrecioNumerico() en vez de convertir el texto por su cuenta.
// ==========================================

// Rango de montos que caben en las columnas monetarias de la base de datos
// (Decimal(10,2): 8 dígitos enteros + 2 decimales, ver
// ItemFactura.precioUnitario y Factura.total en prisma/schema.prisma).
// El mínimo es un centavo (0.01): un monto menor se redondearía a 0.00 al
// guardarse. Un monto mayor al máximo haría fallar el guardado de la
// factura. Fuera de este rango no se considera un monto válido.
export const MONTO_MINIMO = 0.01;
export const MONTO_MAXIMO = 99999999.99;

// Un número escrito "limpio": solo dígitos, con una parte decimal opcional
// (ej. "45000", "1500.50"). Se exige que coincida con TODO el texto (por
// eso los anclajes ^ y $) y no solo con su comienzo: así "3 horas por 5000",
// "10% de descuento" o "45,000" NO se toman por números, en vez de leerse
// como 3, 10 o 45 y facturar un monto equivocado sin avisar.
const FORMATO_NUMERO = /^\d+(\.\d+)?$/;

/**
 * Indica si un número sirve como monto de dinero: finito (ni NaN ni
 * Infinity), positivo (al menos un centavo) y que quepa en las columnas
 * Decimal(10,2) de la base de datos (ver MONTO_MINIMO y MONTO_MAXIMO). Es la
 * única definición de "monto válido" del sistema: la usan
 * parsearPrecioNumerico() para el precio de un equipo, y
 * factura.controller.ts / factura.service.ts para los precios manuales, así
 * todos siguen exactamente la misma regla.
 */
export function esMontoValido(monto: number): boolean {
  return Number.isFinite(monto) && monto >= MONTO_MINIMO && monto <= MONTO_MAXIMO;
}

/**
 * Redondea un monto a centavos (2 decimales), igual que lo hace la base de
 * datos al guardarlo en una columna Decimal(10,2). Se usa ANTES de sumar
 * los renglones de una factura para que el total siempre coincida con la
 * suma de lo que quedó guardado, aunque alguien haya escrito un monto con
 * más decimales (ej. "1500.555").
 */
export function redondearACentavos(monto: number): number {
  return Math.round(monto * 100) / 100;
}

/**
 * Intenta convertir el texto del precio de un equipo (Equipo.precio) a un
 * número, para todo lugar donde el sistema necesita sumar o calcular con él.
 * Devuelve null si el texto no es un monto válido (ej. "Negociable en
 * privado"): quien llama debe decidir qué hacer con un precio no numérico
 * (en la facturación, pedir el monto manual; ver crearFactura).
 *
 * Ejemplos:
 *   parsearPrecioNumerico("45000")                 -> 45000
 *   parsearPrecioNumerico(" 1500.50 ")             -> 1500.5
 *   parsearPrecioNumerico("Negociable en privado") -> null
 *   parsearPrecioNumerico("3 horas por 5000")      -> null
 *   parsearPrecioNumerico("45,000")                -> null
 *   parsearPrecioNumerico("0")                     -> null
 *
 * "45,000" da null a propósito: la coma es ambigua (¿separador de miles o
 * decimal?) y, tratándose de dinero, es más seguro pedir el monto manual
 * que adivinarlo mal. Para que un precio se use de forma automática, debe
 * escribirse sin separador de miles (ej. "45000").
 */
export function parsearPrecioNumerico(precioTexto: string): number | null {
  const texto = precioTexto.trim();

  // Paso 1: todo el texto debe ser un número (ver FORMATO_NUMERO). Sin este
  // filtro, parseFloat aceptaría cualquier texto que EMPIECE con dígitos.
  if (!FORMATO_NUMERO.test(texto)) {
    return null;
  }

  // Paso 2: ya seguro de que el texto es un número, se convierte y se
  // valida que sea un monto utilizable (finito, positivo y que quepa en la
  // base de datos).
  const numero = parseFloat(texto);
  return esMontoValido(numero) ? numero : null;
}
