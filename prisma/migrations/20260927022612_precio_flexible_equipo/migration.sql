/*
  Migración: precio_flexible_equipo

  Propósito: "Equipo.precio" pasa de DECIMAL(10,2) a TEXT para que el dueño del
  negocio pueda escribir una frase (ej. "Negociable en privado", "Precio a
  consultar") en vez de estar obligado a poner un número, manteniendo la
  posibilidad de seguir usando números normales en otros equipos.

  Los equipos que ya existen tienen un precio numérico: esta migración los
  convierte a su representación en texto SIN perder ningún dato (ver USING
  más abajo).

  Nota: no es reversible de forma automática una vez que existan precios con
  frases, porque una frase no se puede volver a convertir a DECIMAL.
*/

-- AlterTable
-- Cambia el tipo de la columna "precio" de la tabla "Equipo" a TEXT.
--
-- Se usa USING (conversión explícita) en vez del cast por defecto de
-- Postgres porque ese cast copia los decimales fijos tal cual ("45000.00"),
-- y lo esperado es que un precio entero quede como "45000":
--   - monto entero      (45000.00) -> "45000"
--   - monto con centavos (1500.50) -> "1500.50" (se conservan los 2 decimales)
-- En ambos casos el texto resultante sigue siendo un número válido, así que
-- los equipos ya existentes seguirán facturándose de forma automática
-- (ver parsearPrecioNumerico en src/utils/precio.ts).
ALTER TABLE "Equipo"
  ALTER COLUMN "precio" SET DATA TYPE TEXT
  USING (
    CASE
      WHEN "precio" = trunc("precio") THEN trunc("precio")::TEXT
      ELSE "precio"::TEXT
    END
  );
