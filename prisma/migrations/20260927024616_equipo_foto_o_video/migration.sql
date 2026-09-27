/*
  Migración: equipo_foto_o_video

  Propósito: permitir que el medio principal de un Equipo sea una FOTO o un
  VIDEO (para los equipos de los que el dueño solo tiene video), en vez de
  solo una foto como hasta ahora.

  Qué cambia:
  - Se crea el enum "TipoMedia" (FOTO, VIDEO).
  - Se agrega "Equipo"."tipoMedia" (obligatorio, por defecto 'FOTO').
  - Se agregan "Equipo"."videoUrl" y "Equipo"."thumbnailUrl" (opcionales).
  - "Equipo"."imagenUrl" NO cambia: ya era opcional (TEXT sin NOT NULL).

  Datos existentes: la migración solo AGREGA (no borra ni convierte nada).
  Como "tipoMedia" tiene DEFAULT 'FOTO', todos los equipos que ya existen
  quedan como FOTO y conservan su "imagenUrl" tal cual; "videoUrl" y
  "thumbnailUrl" quedan en NULL.
*/

-- CreateEnum
-- Tipo de medio principal del equipo: una foto o un video.
CREATE TYPE "TipoMedia" AS ENUM ('FOTO', 'VIDEO');

-- AlterTable
-- Agrega las columnas nuevas de la tabla "Equipo":
--   - "tipoMedia": qué medio es el principal. NOT NULL + DEFAULT 'FOTO' hace
--     que cada fila ya existente reciba 'FOTO' automáticamente, sin
--     necesidad de un UPDATE aparte.
--   - "videoUrl": URL del video en Cloudinary. Solo se usa con tipoMedia =
--     'VIDEO'; opcional (NULL) en cualquier otro caso.
--   - "thumbnailUrl": miniatura/portada del video (imagen fija derivada del
--     propio video). Solo se usa con tipoMedia = 'VIDEO'; opcional (NULL)
--     en cualquier otro caso.
ALTER TABLE "Equipo" ADD COLUMN     "thumbnailUrl" TEXT,
ADD COLUMN     "tipoMedia" "TipoMedia" NOT NULL DEFAULT 'FOTO',
ADD COLUMN     "videoUrl" TEXT;
