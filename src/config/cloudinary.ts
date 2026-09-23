// ==========================================
// Configuración de Cloudinary.
// Inicializa el SDK con las credenciales de la cuenta (leídas de .env) para
// que src/services/upload.service.ts pueda subir imágenes de equipos.
// ==========================================

import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  // Fuerza URLs https en las imágenes devueltas (evita contenido mixto en el frontend).
  secure: true,
});

export default cloudinary;
