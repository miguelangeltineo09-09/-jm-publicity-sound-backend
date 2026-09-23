// ==========================================
// Middleware de autenticación.
// Protege rutas que requieren sesión de admin: valida el JWT enviado en el
// header Authorization y, si es válido, adjunta los datos del admin a
// req.user para que los controladores siguientes puedan usarlos.
// ==========================================

import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

interface JwtPayload {
  id: number;
  email: string;
}

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // El token viaja como "Authorization: Bearer <token>".
  const authHeader = req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Token no proporcionado." });
    return;
  }

  const token = authHeader.slice("Bearer ".length);

  try {
    // jwt.verify lanza una excepción si el token es inválido, está
    // manipulado o ya expiró (pasadas las 8 horas de vida definidas al firmarlo).
    const payload = jwt.verify(
      token,
      process.env.JWT_SECRET as string
    ) as JwtPayload;

    // A partir de aquí, cualquier controlador de una ruta protegida puede
    // leer req.user para saber qué admin hizo la petición.
    req.user = { id: payload.id, email: payload.email };

    next();
  } catch {
    res.status(401).json({ error: "Token inválido o expirado." });
  }
}
