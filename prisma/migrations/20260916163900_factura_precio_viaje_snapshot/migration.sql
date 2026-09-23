/*
  Warnings:

  - Added the required column `precioViajeSnapshot` to the `Factura` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Factura" ADD COLUMN     "precioViajeSnapshot" DECIMAL(10,2) NOT NULL;
