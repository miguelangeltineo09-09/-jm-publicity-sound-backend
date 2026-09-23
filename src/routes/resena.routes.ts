// ==========================================
// Rutas de Reseñas.
// Crear una reseña es público (cualquier cliente, sin cuenta); listar
// todas/moderar/eliminar son exclusivas del admin. La ruta pública para
// ver las reseñas APROBADAS de un equipo puntual vive anidada bajo
// /api/equipos/:id/resenas (ver equipo.routes.ts), no acá.
// ==========================================

import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import {
  actualizarEstadoResena,
  crearResenaHandler,
  eliminarResena,
  listarResenas,
} from "../controllers/resena.controller";

const router = Router();

router.post("/", crearResenaHandler);

router.get("/", authMiddleware, listarResenas);
router.patch("/:id/estado", authMiddleware, actualizarEstadoResena);
router.delete("/:id", authMiddleware, eliminarResena);

export default router;
