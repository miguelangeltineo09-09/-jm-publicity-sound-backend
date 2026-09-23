// ==========================================
// Configuración de Resend.
// Inicializa el cliente con la API key (leída de .env) para que
// src/services/email.service.ts pueda enviar la factura por correo.
// ==========================================

import { Resend } from "resend";

export const resend = new Resend(process.env.RESEND_API_KEY);
