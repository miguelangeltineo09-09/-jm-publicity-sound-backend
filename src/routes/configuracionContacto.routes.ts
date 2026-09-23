// ==========================================
// Rutas de Configuración de Contacto, montadas bajo /api/configuracion-contacto.
// GET es público (el sitio público necesita teléfono/horario/cobertura);
// PUT (editar la única fila) requiere admin autenticado. Sin POST ni
// DELETE: es un singleton, mismo criterio que provincia.routes.ts.
// ==========================================

import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import {
  actualizarConfiguracionContacto,
  obtenerConfiguracionContacto,
} from "../controllers/configuracionContacto.controller";

const router = Router();

router.get("/", obtenerConfiguracionContacto);
router.put("/", authMiddleware, actualizarConfiguracionContacto);

export default router;
