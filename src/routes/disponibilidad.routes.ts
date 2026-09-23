// ==========================================
// Ruta de Disponibilidad.
// Pública: el frontend la consulta para pintar el calendario de un equipo
// antes de que el cliente elija fecha, sin necesitar sesión de admin.
// ==========================================

import { Router } from "express";
import { obtenerDisponibilidad } from "../controllers/disponibilidad.controller";

const router = Router();

router.get("/", obtenerDisponibilidad);

export default router;
