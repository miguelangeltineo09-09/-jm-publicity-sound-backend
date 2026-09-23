// ==========================================
// Servicio de autenticación.
//
// Por qué existe esta capa separada del controlador: el "service" concentra
// la lógica de negocio y el acceso a datos (Prisma, bcrypt, JWT), mientras
// que el controlador solo se encarga de traducir HTTP <-> llamadas a estas
// funciones. Esto permite reutilizar o testear esta lógica sin depender de
// Express (request/response).
// ==========================================

import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../config/prisma";
import type { AdminModel } from "../generated/prisma/models";

// Tiempo de vida del token: pasado este plazo, el admin debe volver a iniciar sesión.
const JWT_EXPIRES_IN = "8h";

/**
 * Verifica que el email exista y que la contraseña en texto plano coincida
 * con el hash guardado en la base de datos.
 *
 * Pasos:
 * 1. Buscar el admin por email.
 * 2. Si no existe, no hay credenciales válidas (se retorna null, no se lanza error,
 *    para no revelar si el email existe o no).
 * 3. Comparar la contraseña recibida contra el hash con bcrypt.
 * 4. Devolver el admin solo si la comparación es exitosa.
 */
export async function verificarCredenciales(
  email: string,
  password: string
): Promise<AdminModel | null> {
  const admin = await prisma.admin.findUnique({ where: { email } });

  if (!admin) {
    return null;
  }

  const passwordValida = await bcrypt.compare(password, admin.passwordHash);

  if (!passwordValida) {
    return null;
  }

  return admin;
}

/**
 * Genera un JWT firmado para un admin ya autenticado.
 * El payload solo lleva id y email: lo mínimo necesario para identificar
 * al usuario en las siguientes peticiones (ver auth.middleware.ts).
 */
export function generarToken(admin: Pick<AdminModel, "id" | "email">): string {
  const jwtSecret = process.env.JWT_SECRET as string;

  return jwt.sign({ id: admin.id, email: admin.email }, jwtSecret, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

// Cantidad de rondas de hashing de bcrypt; misma que usa prisma/seed.ts al
// crear el admin de prueba, para que todas las contraseñas del sistema
// queden protegidas con el mismo costo computacional.
const RONDAS_BCRYPT = 10;

// Cualquier contraseña nueva debe tener al menos esta longitud.
const LONGITUD_MINIMA_PASSWORD = 8;

// Resultado del cambio de contraseña: en vez de lanzar excepciones, se
// devuelve un objeto que dice qué pasó, para que el controlador decida el
// código HTTP correcto (401 si la actual no coincide, 400 si la nueva es
// muy corta) sin tener que inspeccionar mensajes de error a mano.
type ResultadoCambioPassword =
  | { exito: true }
  | { exito: false; motivo: "PASSWORD_ACTUAL_INCORRECTA" | "PASSWORD_NUEVA_INVALIDA" };

/**
 * Cambia la contraseña de un admin.
 *
 * Por qué se exige la contraseña ACTUAL antes de permitir el cambio: es una
 * medida de seguridad estándar. Sin ella, cualquiera que encuentre una
 * sesión abierta (ej. una laptop desbloqueada, o un JWT robado) podría
 * tomar control total de la cuenta cambiando la contraseña sin que el
 * dueño real lo autorice. Pedir la contraseña actual confirma que quien
 * hace el cambio de verdad la conoce, no solo que tiene un token vigente.
 *
 * Pasos:
 * 1. Buscar al admin por id (el id ya viene validado por el JWT, ver
 *    auth.middleware.ts) y comparar la contraseña actual con bcrypt.
 * 2. Si no coincide, devolver el motivo sin tocar la base de datos.
 * 3. Validar que la contraseña nueva cumpla el largo mínimo.
 * 4. Si todo está bien, hashear la nueva contraseña y actualizar el registro.
 */
export async function actualizarPassword(
  id: number,
  passwordActual: string,
  passwordNueva: string
): Promise<ResultadoCambioPassword> {
  const admin = await prisma.admin.findUnique({ where: { id } });

  // Si el admin no existe (caso extremo: se borró entre que se emitió el
  // JWT y esta petición), no hay nada válido contra qué comparar: se trata
  // igual que "contraseña actual incorrecta".
  const passwordActualValida = admin
    ? await bcrypt.compare(passwordActual, admin.passwordHash)
    : false;

  if (!passwordActualValida) {
    return { exito: false, motivo: "PASSWORD_ACTUAL_INCORRECTA" };
  }

  if (passwordNueva.length < LONGITUD_MINIMA_PASSWORD) {
    return { exito: false, motivo: "PASSWORD_NUEVA_INVALIDA" };
  }

  const nuevoHash = await bcrypt.hash(passwordNueva, RONDAS_BCRYPT);

  await prisma.admin.update({
    where: { id },
    data: { passwordHash: nuevoHash },
  });

  return { exito: true };
}
