-- CreateTable
CREATE TABLE "ItemIncluido" (
    "id" SERIAL NOT NULL,
    "equipoId" INTEGER NOT NULL,
    "descripcion" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ItemIncluido_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ItemIncluido" ADD CONSTRAINT "ItemIncluido_equipoId_fkey" FOREIGN KEY ("equipoId") REFERENCES "Equipo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
