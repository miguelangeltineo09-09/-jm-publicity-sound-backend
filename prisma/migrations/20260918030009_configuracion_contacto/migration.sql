-- CreateTable
CREATE TABLE "ConfiguracionContacto" (
    "id" SERIAL NOT NULL,
    "telefono" TEXT NOT NULL,
    "email" TEXT,
    "horarioAtencion" TEXT NOT NULL,
    "mensajeCobertura" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfiguracionContacto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedSocial" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RedSocial_pkey" PRIMARY KEY ("id")
);
