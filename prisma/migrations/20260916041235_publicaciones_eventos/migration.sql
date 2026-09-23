-- CreateEnum
CREATE TYPE "TipoPublicacion" AS ENUM ('FOTO', 'VIDEO');

-- CreateTable
CREATE TABLE "PublicacionEvento" (
    "id" SERIAL NOT NULL,
    "titulo" TEXT NOT NULL,
    "comentario" TEXT,
    "tipo" "TipoPublicacion" NOT NULL,
    "videoUrl" TEXT,
    "thumbnailUrl" TEXT,
    "equipoId" INTEGER NOT NULL,
    "destacado" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicacionEvento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImagenPublicacion" (
    "id" SERIAL NOT NULL,
    "publicacionId" INTEGER NOT NULL,
    "imagenUrl" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ImagenPublicacion_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "PublicacionEvento" ADD CONSTRAINT "PublicacionEvento_equipoId_fkey" FOREIGN KEY ("equipoId") REFERENCES "Equipo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagenPublicacion" ADD CONSTRAINT "ImagenPublicacion_publicacionId_fkey" FOREIGN KEY ("publicacionId") REFERENCES "PublicacionEvento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
