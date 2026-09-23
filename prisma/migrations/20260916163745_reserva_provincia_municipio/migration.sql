-- Editado a mano (Prisma generó esto con --create-only): "municipio" y
-- "provinciaId" deben quedar NOT NULL, pero ya existe al menos una fila en
-- "Reserva" de antes de esta migración. Se agregan las columnas como
-- NULLABLE primero, se rellenan ("backfill") con un valor por defecto
-- razonable para las filas ya existentes, y RECIÉN AHÍ se marcan NOT NULL
-- — el mismo patrón que Prisma sugiere interactivamente cuando detecta este
-- caso, hecho a mano porque este entorno no puede responder ese prompt.

-- AlterTable (columnas nullable por ahora)
ALTER TABLE "Reserva" ADD COLUMN     "municipio" TEXT,
ADD COLUMN     "provinciaId" INTEGER;

-- Backfill de las filas creadas ANTES de que existiera este campo: se
-- usa "Distrito Nacional" como provincia por defecto (la capital, la
-- opción más neutral) y un texto que deja explícito que es un dato
-- histórico sin municipio real registrado — no se está inventando un
-- municipio específico para una reserva real ya existente.
UPDATE "Reserva"
SET "municipio" = 'No especificado (reserva anterior a este campo)',
    "provinciaId" = (SELECT "id" FROM "Provincia" WHERE "nombre" = 'Distrito Nacional')
WHERE "municipio" IS NULL;

-- AlterTable (recién ahora se exige NOT NULL, ya con todas las filas completas)
ALTER TABLE "Reserva" ALTER COLUMN "municipio" SET NOT NULL,
ALTER COLUMN "provinciaId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Reserva" ADD CONSTRAINT "Reserva_provinciaId_fkey" FOREIGN KEY ("provinciaId") REFERENCES "Provincia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
