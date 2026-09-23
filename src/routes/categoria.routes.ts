// ==========================================
// Rutas de Categorías.
// GET es público (catálogo); crear/editar/eliminar requieren admin autenticado.
// ==========================================

import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import {
  actualizarCategoria,
  crearCategoria,
  eliminarCategoria,
  listarCategorias,
} from "../controllers/categoria.controller";

const router = Router();

router.get("/", listarCategorias);
router.post("/", authMiddleware, crearCategoria);
router.put("/:id", authMiddleware, actualizarCategoria);
router.delete("/:id", authMiddleware, eliminarCategoria);

export default router;
