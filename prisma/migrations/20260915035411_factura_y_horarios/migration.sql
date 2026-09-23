/*
  Warnings:

  - Added the required column `horaFin` to the `Reserva` table without a default value. This is not possible if the table is not empty.
  - Added the required column `horaInicio` to the `Reserva` table without a default value. This is not possible if the table is not empty.
  - Made the column `clienteEmail` on table `Reserva` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Reserva" ADD COLUMN     "horaFin" TEXT NOT NULL,
ADD COLUMN     "horaInicio" TEXT NOT NULL,
ALTER COLUMN "clienteEmail" SET NOT NULL;

-- CreateTable
CREATE TABLE "Factura" (
    "id" SERIAL NOT NULL,
    "numeroFactura" TEXT NOT NULL,
    "reservaId" INTEGER NOT NULL,
    "equipoNombre" TEXT NOT NULL,
    "precioUnitario" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "fechaEmision" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Factura_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Factura_numeroFactura_key" ON "Factura"("numeroFactura");

-- CreateIndex
CREATE UNIQUE INDEX "Factura_reservaId_key" ON "Factura"("reservaId");

-- AddForeignKey
ALTER TABLE "Factura" ADD CONSTRAINT "Factura_reservaId_fkey" FOREIGN KEY ("reservaId") REFERENCES "Reserva"("id") ON DELETE CASCADE ON UPDATE CASCADE;
