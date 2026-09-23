// ==========================================
// Rutas de Equipos.
// GET son públicas (catálogo); el resto requiere admin autenticado.
// POST/PUT usan multer para aceptar multipart/form-data (datos + imagen).
// ==========================================

import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { upload } from "../config/multer";
import {
  actualizarEquipo,
  cambiarDisponibilidad,
  crearEquipo,
  eliminarEquipo,
  listarEquipos,
  obtenerEquipo,
} from "../controllers/equipo.controller";
// Reseñas públicas de un equipo puntual: viven en resena.controller.ts
// (junto con el resto de la lógica de reseñas), pero la ruta se monta
// acá, anidada bajo /api/equipos/:id, porque es donde tiene sentido para
// quien consume la API (es un dato MÁS de un equipo, no una colección
// aparte) — el resto de las rutas de reseñas (crear, moderar, listar
// todas) sí vive en su propio resena.routes.ts, montado en /api/resenas.
import { listarResenasDeEquipo } from "../controllers/resena.controller";
// Ítems incluidos de un equipo puntual (listar/crear/reordenar): mismo
// criterio que arriba con las reseñas — se anidan acá porque son "un dato
// más" de ESE equipo. Editar/eliminar un ítem por su propio id vive en su
// propio itemIncluido.routes.ts, montado en /api/items-incluidos.
import {
  crearItemIncluido,
  listarItemsIncluidos,
  reordenarItemsIncluidos,
} from "../controllers/itemIncluido.controller";

const router = Router();

router.get("/", listarEquipos);
router.get("/:id", obtenerEquipo);
router.get("/:id/resenas", listarResenasDeEquipo);
router.get("/:id/items-incluidos", listarItemsIncluidos);

// "imagen" es el nombre del campo de archivo esperado en el form-data.
router.post("/", authMiddleware, upload.single("imagen"), crearEquipo);
router.put("/:id", authMiddleware, upload.single("imagen"), actualizarEquipo);
router.post("/:id/items-incluidos", authMiddleware, crearItemIncluido);

router.delete("/:id", authMiddleware, eliminarEquipo);
router.patch("/:id/disponibilidad", authMiddleware, cambiarDisponibilidad);
router.patch("/:id/items-incluidos/orden", authMiddleware, reordenarItemsIncluidos);

export default router;
