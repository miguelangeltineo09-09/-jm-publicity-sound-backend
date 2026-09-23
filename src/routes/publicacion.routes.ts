// ==========================================
// Rutas de Publicaciones de eventos.
// Listar y ver detalle son públicos (para mostrarlas en el sitio); crear,
// editar y eliminar requieren admin autenticado.
// ==========================================

import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { uploadEventos } from "../config/multer";
import {
  actualizarPublicacion,
  crearPublicacion,
  eliminarPublicacion,
  listarPublicaciones,
  obtenerPublicacion,
} from "../controllers/publicacion.controller";

const router = Router();

router.get("/", listarPublicaciones);
router.get("/:id", obtenerPublicacion);

// ".fields(...)" (no ".single"/".array") porque una misma publicación
// puede traer o un solo video ("video") o varias fotos ("imagenes"), y
// multer necesita conocer de antemano los nombres de campo posibles; cuál
// de los dos es válido para el "tipo" recibido se valida en el controlador.
router.post(
  "/",
  authMiddleware,
  uploadEventos.fields([
    { name: "video", maxCount: 1 },
    { name: "imagenes", maxCount: 20 },
  ]),
  crearPublicacion
);

router.patch("/:id", authMiddleware, actualizarPublicacion);
router.delete("/:id", authMiddleware, eliminarPublicacion);

export default router;
