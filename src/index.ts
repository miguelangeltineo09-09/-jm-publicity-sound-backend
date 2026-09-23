// ==========================================
// Punto de entrada del servidor Express.
// Aquí solo se configura el esqueleto de la app: middlewares globales,
// carga de variables de entorno y arranque del servidor.
// La lógica de negocio (rutas, controladores, etc.) se agrega en fases siguientes.
// ==========================================

// --- Imports ---
// "dotenv/config" va primero e importado por su efecto secundario (carga
// las variables de ".env" a process.env). Es intencional que sea el primer
// import: en el JS compilado, los imports se ejecutan en orden antes que
// cualquier otra línea del archivo, así que si otro módulo importado después
// (por ejemplo authRoutes, que en cadena llega a src/config/prisma.ts) lee
// process.env.DATABASE_URL al cargarse, ya lo encuentra disponible.
import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import authRoutes from "./routes/auth.routes";
import categoriaRoutes from "./routes/categoria.routes";
import equipoRoutes from "./routes/equipo.routes";
import reservaRoutes from "./routes/reserva.routes";
import disponibilidadRoutes from "./routes/disponibilidad.routes";
import facturaRoutes from "./routes/factura.routes";
import publicacionRoutes from "./routes/publicacion.routes";
import resenaRoutes from "./routes/resena.routes";
import itemIncluidoRoutes from "./routes/itemIncluido.routes";
import provinciaRoutes from "./routes/provincia.routes";
import preguntaFrecuenteRoutes from "./routes/preguntaFrecuente.routes";
import configuracionContactoRoutes from "./routes/configuracionContacto.routes";
import redSocialRoutes from "./routes/redSocial.routes";

// --- Configuración de variables de entorno ---
// Puerto del servidor: se usa el valor de .env o 4000 como valor por defecto.
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

// Origen permitido para CORS: solo el frontend definido en .env puede
// consumir esta API. Esto evita que cualquier dominio externo haga requests.
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// --- Inicialización de la app Express ---
const app = express();

// Middleware para parsear cuerpos de peticiones en formato JSON.
app.use(express.json());

// Middleware de CORS: restringe las peticiones al origen del frontend
// configurado, evitando accesos desde dominios no autorizados.
app.use(
  cors({
    origin: FRONTEND_URL,
  })
);

// --- Rutas ---

// Endpoint de salud (health check): permite verificar que el servidor
// está levantado y respondiendo correctamente (útil para monitoreo/deploy).
app.get("/api/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

// Rutas de autenticación del admin (login), montadas bajo /api/auth.
app.use("/api/auth", authRoutes);

// Catálogo: categorías y equipos, montados bajo /api/categorias y /api/equipos.
app.use("/api/categorias", categoriaRoutes);
app.use("/api/equipos", equipoRoutes);

// Provincias para la cotización de viaje/dieta según dónde sea el evento
// (ver Reserva.provinciaId y factura.service.ts).
app.use("/api/provincias", provinciaRoutes);

// Reservas de clientes y consulta pública de fechas bloqueadas por equipo.
app.use("/api/reservas", reservaRoutes);
app.use("/api/disponibilidad", disponibilidadRoutes);

// Facturación: exclusiva del admin (emitir, listar, descargar el PDF).
app.use("/api/facturas", facturaRoutes);

// Publicaciones de eventos realizados (fotos/videos de trabajos ya
// hechos): listar/ver son públicos, crear/editar/eliminar son del admin.
app.use("/api/publicaciones", publicacionRoutes);

// Reseñas de equipos: crear es público, moderar/listar todas es del
// admin. La ruta pública "/api/equipos/:id/resenas" (solo las APROBADA de
// un equipo puntual) se monta dentro de equipoRoutes, no acá.
app.use("/api/resenas", resenaRoutes);

// Ítems incluidos en el alquiler de un equipo (ej. "4 monitores"): editar
// y eliminar un ítem puntual por su propio id se montan acá. Listar,
// crear y reordenar los ítems de un equipo se montan dentro de
// equipoRoutes en su lugar (anidados bajo /api/equipos/:id).
app.use("/api/items-incluidos", itemIncluidoRoutes);

// Preguntas frecuentes de la sección "Preguntas frecuentes" del sitio
// público: listar es público, crear/editar/eliminar/reordenar son del admin.
app.use("/api/preguntas-frecuentes", preguntaFrecuenteRoutes);

// Configuración de contacto (singleton: teléfono, email, horario,
// mensaje de cobertura) y redes sociales del negocio, ambas editables
// desde el panel y mostradas en el sitio público.
app.use("/api/configuracion-contacto", configuracionContactoRoutes);
app.use("/api/redes-sociales", redSocialRoutes);

// --- Arranque del servidor ---
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
