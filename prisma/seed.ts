// ==========================================
// Script de seed (datos iniciales).
// Se ejecuta con `npm run db:seed` (o automáticamente tras
// `prisma migrate dev`, según lo configurado en prisma7.config.ts).
// Crea los datos mínimos para poder probar el sistema: un admin y las
// categorías base del catálogo.
// ==========================================

import "dotenv/config";
import bcrypt from "bcrypt";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// El seed corre como script independiente (no arranca src/index.ts, que es
// donde normalmente se llama a dotenv.config()), así que debe cargar el
// ".env" por su cuenta antes de leer DATABASE_URL. También necesita su propia
// instancia de Prisma con el driver adapter, igual que src/config/prisma.ts.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  // --- Admin de prueba ---
  // Se usa "upsert" (en vez de "create") para que el script se pueda correr
  // varias veces sin fallar por el email duplicado (@unique).
  const passwordHash = await bcrypt.hash("CambiarEstaClave123", 10);

  await prisma.admin.upsert({
    where: { email: "admin@jmpublicitysound.com" },
    update: {},
    create: {
      email: "admin@jmpublicitysound.com",
      passwordHash,
    },
  });

  // --- Categorías iniciales del catálogo ---
  const categorias = ["Bocinas", "Micrófonos", "Luces", "Consolas"];

  for (const nombre of categorias) {
    await prisma.categoria.upsert({
      where: { nombre },
      update: {},
      create: { nombre },
    });
  }

  // --- Provincias/demarcaciones de República Dominicana ---
  // Las 32 provincias/demarcaciones del país, con precioViaje en 0 hasta
  // que el admin lo configure desde el panel (ver PUT /api/provincias/:id).
  // "upsert" (igual que arriba con las categorías) para que este script se
  // pueda correr varias veces sin duplicar filas ni fallar por el nombre
  // duplicado (@unique) — y sin pisar un precioViaje que el admin ya haya
  // editado, ya que "update: {}" no cambia nada si la provincia ya existe.
  const provincias = [
    "Distrito Nacional",
    "Azua",
    "Bahoruco",
    "Barahona",
    "Dajabón",
    "Duarte",
    "Elías Piña",
    "El Seibo",
    "Espaillat",
    "Hato Mayor",
    "Independencia",
    "La Altagracia",
    "La Romana",
    "La Vega",
    "María Trinidad Sánchez",
    "Monseñor Nouel",
    "Monte Cristi",
    "Monte Plata",
    "Pedernales",
    "Peravia",
    "Puerto Plata",
    "Hermanas Mirabal (Salcedo)",
    "Samaná",
    "San Cristóbal",
    "San José de Ocoa",
    "San Juan",
    "San Pedro de Macorís",
    "Sánchez Ramírez",
    "Santiago",
    "Santiago Rodríguez",
    "Santo Domingo",
    "Valverde",
  ];

  for (const nombre of provincias) {
    await prisma.provincia.upsert({
      where: { nombre },
      update: {},
      create: { nombre },
    });
  }

  // --- Preguntas frecuentes (sección "Preguntas frecuentes" del sitio) ---
  // IMPORTANTE: estas 8 preguntas son de EJEMPLO/PLACEHOLDER. Varias
  // respuestas quedan marcadas con "[Completar: ...]" a propósito, porque
  // dependen de decisiones del negocio que este seed no puede inventar
  // (política de cancelación, si se cobra depósito, etc.). El DUEÑO DEL
  // NEGOCIO debe reemplazar estas respuestas con las reales desde el
  // panel de admin (PUT /api/preguntas-frecuentes/:id) antes de que la
  // sección se considere lista para publicarse tal cual.
  //
  // A diferencia del admin/categorías/provincias de arriba, acá NO se usa
  // "upsert" con un id fijo (1 a 8): "id" es autoincrement y forzarlo a
  // mano con valores explícitos desincroniza la secuencia de Postgres
  // (SERIAL) del valor real ya insertado — la primera pregunta que cree
  // el admin desde el panel (sin id explícito, dejando que la secuencia
  // lo asigne) chocaría con estos ids ya usados y fallaría por clave
  // duplicada. En su lugar, se siembra solo SI LA TABLA ESTÁ VACÍA (nunca
  // se corrió este seed antes): así "id" y "orden" quedan asignados de
  // forma normal por Prisma/Postgres, y una segunda corrida del script no
  // duplica nada ni pisa preguntas que el admin ya haya creado o editado.
  const preguntasFrecuentes: { pregunta: string; respuesta: string }[] = [
    {
      pregunta: "¿Con cuánta anticipación debo reservar?",
      respuesta:
        "Recomendamos reservar con al menos [completar] de anticipación para garantizar disponibilidad. [Editar esta respuesta desde el panel de administración].",
    },
    {
      pregunta: "¿El precio incluye el transporte?",
      respuesta:
        "No, el precio del equipo no incluye el costo de viaje. Este se calcula automáticamente según la provincia donde sea el evento, y se muestra antes de confirmar tu solicitud.",
    },
    {
      pregunta: "¿Necesito pagar un depósito para apartar la fecha?",
      respuesta:
        "[Completar: indicar si se requiere depósito, monto o porcentaje]. Edita esta respuesta desde el panel de administración.",
    },
    {
      pregunta: "¿Cubren eventos en cualquier parte del país?",
      respuesta:
        "Sí, ofrecemos servicio en todas las provincias de República Dominicana. El costo de viaje varía según la distancia.",
    },
    {
      pregunta: "¿El equipo incluye un técnico/operador?",
      respuesta:
        "[Completar: indicar si el alquiler incluye personal técnico o solo el equipo]. Edita esta respuesta desde el panel de administración.",
    },
    {
      pregunta: "¿Qué pasa si necesito cancelar mi reserva?",
      respuesta: "[Completar: indicar la política de cancelación]. Edita esta respuesta desde el panel de administración.",
    },
    {
      pregunta: "¿Cuál es el tiempo mínimo de alquiler?",
      respuesta:
        "[Completar: indicar si hay un mínimo de horas o si es por evento]. Edita esta respuesta desde el panel de administración.",
    },
    {
      pregunta: "¿Cómo confirmo mi reserva?",
      respuesta:
        "Al enviar tu solicitud desde el sitio, queda pendiente de revisión. Nuestro equipo se pondrá en contacto contigo para confirmar los detalles y la disponibilidad final.",
    },
  ];

  const totalPreguntasExistentes = await prisma.preguntaFrecuente.count();
  if (totalPreguntasExistentes === 0) {
    // "orden" = índice en el array (0 a 7): coincide con el orden 1 a 8
    // pedido, empezando en 0 (mismo criterio de "0 = primera" que
    // ItemIncluido.orden).
    await prisma.preguntaFrecuente.createMany({
      data: preguntasFrecuentes.map(({ pregunta, respuesta }, indice) => ({
        pregunta,
        respuesta,
        orden: indice,
      })),
    });
  }

  // --- Configuración de contacto (singleton) ---
  // Mismo criterio que las preguntas frecuentes de arriba: NO se usa
  // "upsert" con un id fijo (desincroniza la secuencia autoincrement de
  // Postgres); se siembra solo si la tabla está vacía. Como esta tabla
  // debe tener SIEMPRE exactamente una fila (ver el comentario del
  // modelo en schema.prisma), este chequeo también evita crear una
  // segunda fila por error si el seed se corre de nuevo.
  const totalConfiguracionExistente = await prisma.configuracionContacto.count();
  if (totalConfiguracionExistente === 0) {
    await prisma.configuracionContacto.create({
      data: {
        telefono: "8296450922",
        email: null,
        horarioAtencion: "Lunes a Domingo, 9:00 AM - 6:00 PM",
        mensajeCobertura: "Trabajamos a domicilio en toda República Dominicana",
      },
    });
  }

  // --- Redes sociales ---
  // "findFirst" por "nombre" (no hay restricción @unique en ese campo,
  // a propósito: el admin puede tener más de una cuenta con el mismo
  // nombre de red si alguna vez hiciera falta) en vez de "upsert" — mismo
  // motivo que arriba, evitar un id explícito en una columna autoincrement.
  const instagramExistente = await prisma.redSocial.findFirst({ where: { nombre: "Instagram" } });
  if (!instagramExistente) {
    await prisma.redSocial.create({
      data: {
        nombre: "Instagram",
        url: "https://www.instagram.com/jm_publicity_sound?stkn=aGkxMzRjNnR3cng3",
        orden: 0,
      },
    });
  }

  console.log(
    `Seed completado: admin, categorías iniciales, ${provincias.length} provincias, ${
      totalPreguntasExistentes === 0 ? preguntasFrecuentes.length : "0 (ya existían)"
    } preguntas frecuentes, ${totalConfiguracionExistente === 0 ? 1 : "0 (ya existía)"} configuración de contacto y ${
      instagramExistente ? "0 (ya existía)" : 1
    } red social creados.`
  );
}

main()
  .catch((error) => {
    console.error("Error al ejecutar el seed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
