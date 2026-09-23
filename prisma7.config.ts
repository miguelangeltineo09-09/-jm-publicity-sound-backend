// ==========================================
// Configuración de Prisma CLI (generate, migrate, studio, etc.).
// Este archivo le indica al CLI dónde está el esquema, dónde guardar
// las migraciones y cómo obtener la URL de conexión a la base de datos.
// ==========================================

// Carga las variables de entorno del archivo .env antes de leer DATABASE_URL.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  // Ruta al archivo de esquema de Prisma.
  schema: "prisma/schema.prisma",

  // Carpeta donde Prisma guardará el historial de migraciones de la BD,
  // y comando de seed que se ejecuta automáticamente después de cada
  // `prisma migrate dev` (también se puede correr manualmente con `npm run db:seed`).
  migrations: {
    path: "prisma/migrations",
    seed: "ts-node prisma/seed.ts",
  },

  // Cadena de conexión a PostgreSQL, tomada de la variable de entorno
  // DATABASE_URL (ver .env.example).
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
