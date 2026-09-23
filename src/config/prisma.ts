// ==========================================
// Cliente de Prisma (singleton).
//
// Por qué un singleton: con ts-node-dev (hot-reload), cada cambio de archivo
// re-ejecuta el módulo. Si se creara un PrismaClient nuevo en cada import,
// se abrirían múltiples pools de conexión a la base de datos hasta agotarlas.
// Guardando la instancia en una variable global se reutiliza la misma
// conexión entre recargas durante el desarrollo.
// ==========================================

import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// El generador "prisma-client" (usado en prisma/schema.prisma) no incluye un
// motor de consultas embebido: en su lugar requiere un "driver adapter" que
// haga la conexión real a PostgreSQL usando el driver "pg". Por eso se arma
// aquí explícitamente en vez de dejar que Prisma lea DATABASE_URL solo.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

// Variable global tipada para guardar la instancia entre recargas de módulo en desarrollo.
const globalForPrisma = global as unknown as { prisma?: PrismaClient };

// Reutiliza la instancia existente si ya fue creada (hot-reload); si no, crea una nueva.
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

// Solo se guarda en global fuera de producción: en producción cada proceso
// arranca una sola vez, así que no hace falta este mecanismo de caché.
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
