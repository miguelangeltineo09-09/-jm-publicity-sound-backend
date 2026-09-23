// ==========================================
// Extensión de tipos de Express.
// Declara el campo "user" en Request para que TypeScript reconozca
// req.user (asignado por auth.middleware.ts) en controladores y rutas protegidas.
// ==========================================

import "express";

declare global {
  namespace Express {
    interface Request {
      // Datos mínimos del admin autenticado, extraídos del payload del JWT.
      user?: {
        id: number;
        email: string;
      };
    }
  }
}
