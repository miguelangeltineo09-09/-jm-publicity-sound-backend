-- DropForeignKey
ALTER TABLE "Reserva" DROP CONSTRAINT "Reserva_equipoId_fkey";

-- AddForeignKey
ALTER TABLE "Reserva" ADD CONSTRAINT "Reserva_equipoId_fkey" FOREIGN KEY ("equipoId") REFERENCES "Equipo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
