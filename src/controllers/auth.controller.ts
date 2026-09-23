// ==========================================
// Controlador de autenticación.
//
// Por qué se separa del "service": este archivo solo traduce la petición
// HTTP (leer body, devolver status/json) a llamadas al servicio, que es
// donde vive la lógica real (consultar BD, comparar password, firmar JWT).
// Así el controlador se mantiene simple y el service es reutilizable.
// ==========================================

import type { Request, Response } from "express";
import { actualizarPassword, generarToken, verificarCredenciales } from "../services/auth.service";

/**
 * POST /api/auth/login
 *
 * Pasos:
 * 1. Validar que el body traiga email y password.
 * 2. Verificar las credenciales contra la base de datos (auth.service).
 * 3. Si son inválidas, responder 401 sin dar detalles de cuál dato falló.
 * 4. Si son válidas, generar y devolver un JWT para las siguientes peticiones.
 */
export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: "Email y password son obligatorios." });
    return;
  }

  const admin = await verificarCredenciales(email, password);

  if (!admin) {
    res.status(401).json({ error: "Credenciales inválidas." });
    return;
  }

  const token = generarToken(admin);

  res.status(200).json({ token });
}

/**
 * PATCH /api/auth/password
 * Ruta protegida (ver auth.routes.ts): requiere un JWT válido. Permite al
 * admin autenticado cambiar su propia contraseña.
 *
 * Pasos:
 * 1. Validar que el body traiga passwordActual y passwordNueva.
 * 2. Delegar al service, que verifica la contraseña actual y valida la nueva.
 * 3. Traducir el resultado al código HTTP correspondiente: 401 si la
 *    contraseña actual no coincide, 400 si la nueva es muy corta, 200 si
 *    todo salió bien (sin devolver ningún dato sensible, solo un mensaje).
 */
export async function cambiarPassword(req: Request, res: Response): Promise<void> {
  const { passwordActual, passwordNueva } = req.body as {
    passwordActual?: string;
    passwordNueva?: string;
  };

  if (!passwordActual || !passwordNueva) {
    res.status(400).json({ error: "passwordActual y passwordNueva son obligatorios." });
    return;
  }

  // authMiddleware ya validó el JWT antes de llegar aquí y adjuntó req.user;
  // se revisa de todas formas en vez de asumirlo, para no depender de un
  // "as" o un "!" sobre un valor que en teoría siempre debería existir.
  if (!req.user) {
    res.status(401).json({ error: "No autenticado." });
    return;
  }

  const resultado = await actualizarPassword(req.user.id, passwordActual, passwordNueva);

  if (!resultado.exito) {
    if (resultado.motivo === "PASSWORD_ACTUAL_INCORRECTA") {
      res.status(401).json({ error: "La contraseña actual es incorrecta." });
      return;
    }
    res.status(400).json({ error: "La nueva contraseña debe tener al menos 8 caracteres." });
    return;
  }

  res.status(200).json({ mensaje: "Contraseña actualizada correctamente." });
}
