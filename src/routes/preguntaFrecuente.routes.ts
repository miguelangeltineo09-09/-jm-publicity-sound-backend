// ==========================================
// Rutas de Preguntas Frecuentes, montadas bajo /api/preguntas-frecuentes.
// Listar es público (la sección "Preguntas frecuentes" del sitio); crear,
// editar, eliminar y reordenar son exclusivos del admin — mismo criterio
// que categoria.routes.ts.
// ==========================================

import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import {
  actualizarPreguntaFrecuente,
  crearPreguntaFrecuente,
  eliminarPreguntaFrecuente,
  listarPreguntasFrecuentes,
  reordenarPreguntasFrecuentes,
} from "../controllers/preguntaFrecuente.controller";

const router = Router();

router.get("/", listarPreguntasFrecuentes);

router.post("/", authMiddleware, crearPreguntaFrecuente);
// "/orden" (PATCH) no choca con "/:id" (PUT/DELETE, más abajo): son
// verbos HTTP distintos, Express los matchea por separado sin ambigüedad
// de orden entre rutas de métodos diferentes.
router.patch("/orden", authMiddleware, reordenarPreguntasFrecuentes);
router.put("/:id", authMiddleware, actualizarPreguntaFrecuente);
router.delete("/:id", authMiddleware, eliminarPreguntaFrecuente);

export default router;
