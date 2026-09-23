/*
  Warnings:

  - You are about to drop the column `equipoNombre` on the `Factura` table. All the data in the column will be lost.
  - You are about to drop the column `precioUnitario` on the `Factura` table. All the data in the column will be lost.
  - You are about to drop the column `equipoId` on the `Reserva` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Reserva" DROP CONSTRAINT "Reserva_equipoId_fkey";

-- AlterTable
ALTER TABLE "Factura" DROP COLUMN "equipoNombre",
DROP COLUMN "precioUnitario";

-- AlterTable
ALTER TABLE "Reserva" DROP COLUMN "equipoId";

-- CreateTable
CREATE TABLE "ReservaEquipo" (
    "id" SERIAL NOT NULL,
    "reservaId" INTEGER NOT NULL,
    "equipoId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservaEquipo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemFactura" (
    "id" SERIAL NOT NULL,
    "facturaId" INTEGER NOT NULL,
    "equipoNombre" TEXT NOT NULL,
    "precioUnitario" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemFactura_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReservaEquipo_reservaId_equipoId_key" ON "ReservaEquipo"("reservaId", "equipoId");

-- AddForeignKey
ALTER TABLE "ReservaEquipo" ADD CONSTRAINT "ReservaEquipo_reservaId_fkey" FOREIGN KEY ("reservaId") REFERENCES "Reserva"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservaEquipo" ADD CONSTRAINT "ReservaEquipo_equipoId_fkey" FOREIGN KEY ("equipoId") REFERENCES "Equipo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemFactura" ADD CONSTRAINT "ItemFactura_facturaId_fkey" FOREIGN KEY ("facturaId") REFERENCES "Factura"("id") ON DELETE CASCADE ON UPDATE CASCADE;
