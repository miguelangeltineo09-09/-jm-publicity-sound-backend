// ==========================================
// Rutas de autenticación.
// Mapea los endpoints HTTP de /api/auth a sus controladores.
// Se registra en src/index.ts bajo el prefijo "/api/auth".
// ==========================================

import { Router } from "express";
import { cambiarPassword, login } from "../controllers/auth.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = Router();

// POST /api/auth/login: inicio de sesión del admin, devuelve un JWT.
router.post("/login", login);

// PATCH /api/auth/password: cambio de contraseña. Protegida: solo un admin
// ya autenticado (con JWT válido) puede cambiar su propia contraseña.
router.patch("/password", authMiddleware, cambiarPassword);

export default router;
