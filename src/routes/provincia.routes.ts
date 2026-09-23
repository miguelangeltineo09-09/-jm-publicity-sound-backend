// ==========================================
// Rutas de Provincias.
// GET es público (catálogo fijo de provincias para el select del
// formulario de reserva); PUT (editar precioViaje) requiere admin
// autenticado. Sin POST ni DELETE: la lista de provincias no se crea ni
// se borra desde la API (ver provincia.controller.ts).
// ==========================================

import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { actualizarPrecioViaje, listarProvincias } from "../controllers/provincia.controller";

const router = Router();

router.get("/", listarProvincias);
router.put("/:id", authMiddleware, actualizarPrecioViaje);

export default router;
