// ==========================================
// Rutas de Facturas.
// Todo bajo /api/facturas es exclusivo del admin: a diferencia del
// catálogo o de crear una reserva, facturar y ver facturas no es algo que
// el cliente final deba poder hacer.
// ==========================================

import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import {
  descargarFacturaPDF,
  emitirFactura,
  enviarFactura,
  listarFacturas,
} from "../controllers/factura.controller";

const router = Router();

router.get("/", authMiddleware, listarFacturas);
router.post("/:reservaId", authMiddleware, emitirFactura);
router.get("/:facturaId/pdf", authMiddleware, descargarFacturaPDF);
router.post("/:facturaId/enviar", authMiddleware, enviarFactura);

export default router;
