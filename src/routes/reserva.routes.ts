// ==========================================
// Rutas de Reservas.
// Crear una reserva es público (lo hace el cliente final); todo lo demás
// (listar, ver detalle, cambiar estado, borrar) es exclusivo del admin.
// La única excepción es POST /admin: también crea una reserva, pero
// protegida — es el admin registrando a mano una reserva hecha en
// persona o por WhatsApp (ver reserva.controller.ts).
// ==========================================

import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import {
  actualizarEstadoReserva,
  crearReserva,
  crearReservaAdmin,
  eliminarReserva,
  listarReservas,
  obtenerCalendarioReservas,
  obtenerReserva,
} from "../controllers/reserva.controller";

const router = Router();

router.post("/", crearReserva);
router.post("/admin", authMiddleware, crearReservaAdmin);

router.get("/", authMiddleware, listarReservas);
// "/calendario" va ANTES de "/:id" a propósito: Express prueba las rutas
// en el orden en que se registran, y "/:id" matchea cualquier segmento
// (incluida la palabra "calendario") como si fuera un id de reserva. Si
// "/:id" quedara primero, GET /api/reservas/calendario nunca llegaría a
// obtenerCalendarioReservas — obtenerReserva la interceptaría antes,
// intentando (sin éxito) buscar una reserva con id "calendario".
router.get("/calendario", authMiddleware, obtenerCalendarioReservas);
router.get("/:id", authMiddleware, obtenerReserva);
router.patch("/:id/estado", authMiddleware, actualizarEstadoReserva);
router.delete("/:id", authMiddleware, eliminarReserva);

export default router;
