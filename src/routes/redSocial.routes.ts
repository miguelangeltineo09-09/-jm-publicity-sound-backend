// ==========================================
// Rutas de Redes Sociales, montadas bajo /api/redes-sociales.
// Listar es público; crear, editar, eliminar y reordenar son exclusivos
// del admin — mismo criterio que preguntaFrecuente.routes.ts.
// ==========================================

import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import {
  actualizarRedSocial,
  crearRedSocial,
  eliminarRedSocial,
  listarRedesSociales,
  reordenarRedesSociales,
} from "../controllers/redSocial.controller";

const router = Router();

router.get("/", listarRedesSociales);

router.post("/", authMiddleware, crearRedSocial);
// "/orden" (PATCH) no choca con "/:id" (PUT/DELETE, más abajo): son
// verbos HTTP distintos, mismo criterio que preguntaFrecuente.routes.ts.
router.patch("/orden", authMiddleware, reordenarRedesSociales);
router.put("/:id", authMiddleware, actualizarRedSocial);
router.delete("/:id", authMiddleware, eliminarRedSocial);

export default router;
