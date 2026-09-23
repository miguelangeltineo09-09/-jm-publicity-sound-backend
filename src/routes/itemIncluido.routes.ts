// ==========================================
// Rutas de Ítems Incluidos que operan sobre un ítem PUNTUAL por su propio
// id (editar, eliminar) — montadas bajo /api/items-incluidos.
//
// Las otras dos operaciones (listar los ítems de un equipo, crear uno
// nuevo, y reordenar varios a la vez) viven anidadas bajo /api/equipos/:id
// en equipo.routes.ts en su lugar, porque conceptualmente son "un dato más
// de ESE equipo", no una colección aparte — mismo criterio ya usado para
// las reseñas públicas de un equipo (ver resena.routes.ts). Ambos routers
// importan sus handlers desde itemIncluido.controller.ts.
// ==========================================

import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { actualizarItemIncluido, eliminarItemIncluido } from "../controllers/itemIncluido.controller";

const router = Router();

router.put("/:itemId", authMiddleware, actualizarItemIncluido);
router.delete("/:itemId", authMiddleware, eliminarItemIncluido);

export default router;
