// ==========================================
// Controlador de Reservas.
//
// CAMBIO DE RELACIÓN CLAVE (ver también el comentario largo en el modelo
// Reserva de prisma/schema.prisma): antes una Reserva tenía un solo
// "equipoId" (relación 1 a 1 con Equipo). Ahora una Reserva representa
// UN EVENTO (una fecha, un horario) que puede incluir VARIOS equipos —
// la relación es muchos a muchos, a través de la tabla intermedia
// ReservaEquipo. Todo este archivo pasó de recibir/manejar "equipoId"
// (número) a "equipoIds" (array de números, mínimo 1).
//
// REGLA DE NEGOCIO CLAVE (ver también disponibilidad.controller.ts):
// Una reserva nace PENDIENTE y NO bloquea ninguna fecha todavía: dos
// clientes pueden pedir el mismo equipo para el mismo día y ambas quedan
// pendientes. Solo cuando el admin la pasa a CONFIRMADA, esa fecha queda
// bloqueada para ESE equipo puntual (no para todo el catálogo). Si la
// pasa a RECHAZADA, la fecha vuelve a quedar libre. Por eso, en todo
// este archivo, "fecha ocupada" siempre significa "existe una reserva
// CONFIRMADA que incluye a ese equipo en ese día", nunca solo "existe
// una reserva". Y como todos los equipos de una misma reserva comparten
// fecha/horario (un solo evento), una fecha solo es válida para la
// solicitud completa si TODOS los equipos elegidos están libres ese
// día — si UNO SOLO ya está confirmado esa fecha, se rechaza la
// solicitud completa (ver equiposOcupadosEnFecha más abajo).
// ==========================================

import type { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { Prisma } from "../generated/prisma/client";
import type { ReservaWhereInput } from "../generated/prisma/models";
import { EstadoReserva } from "../generated/prisma/enums";

// Errores propios para poder distinguir, al salir de una transacción o
// validación, qué código HTTP corresponde (404 vs 409) sin acoplar esta
// lógica de negocio a Express.
class ReservaNoEncontradaError extends Error {}
class FechaNoDisponibleError extends Error {}

// Formato "HH:mm" en 24 horas (ej. "18:00", "08:30"). Se valida con esta
// regex antes de confiar en el string para cualquier otra cosa.
const FORMATO_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

// Convierte "HH:mm" a minutos desde la medianoche, para poder comparar dos
// horas numéricamente (ej. para chequear que horaFin sea posterior a
// horaInicio) sin depender de que la comparación de strings coincida con
// el orden cronológico.
function horaAMinutos(hora: string): number {
  const [horas, minutos] = hora.split(":").map(Number);
  return horas * 60 + minutos;
}

// Dado cualquier Date, devuelve el rango [inicio, fin) del día calendario
// al que pertenece, en UTC. Se usa para comparar "misma fecha de evento"
// ignorando la hora exacta y evitando ambigüedades de zona horaria del
// servidor (todo se calcula en UTC, no en la hora local del proceso).
function rangoDelDia(fecha: Date): { inicio: Date; fin: Date } {
  const inicio = new Date(
    Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate())
  );
  const fin = new Date(inicio);
  fin.setUTCDate(fin.getUTCDate() + 1);
  return { inicio, fin };
}

// Igual criterio que rangoDelDia, pero para un mes completo: devuelve
// [inicio, fin) en UTC del mes indicado (ej. mes=9, anio=2026 -> del 1 de
// septiembre 00:00 UTC al 1 de octubre 00:00 UTC), para usarse como filtro
// "fechaEvento >= inicio Y < fin" en obtenerCalendarioReservas. "mes" es
// 1-12 (humano), no 0-11 (el índice que usa el objeto Date de JS
// internamente) — se resta 1 recién al construir el Date.UTC.
function rangoDelMes(mes: number, anio: number): { inicio: Date; fin: Date } {
  const inicio = new Date(Date.UTC(anio, mes - 1, 1));
  const fin = new Date(Date.UTC(anio, mes, 1));
  return { inicio, fin };
}

/**
 * De la lista "equipoIds", devuelve el SUBCONJUNTO que ya tiene una
 * reserva CONFIRMADA en el día de "fecha" — es decir, cuáles de esos
 * equipos puntuales están ocupados. Vacío significa "ninguno está
 * ocupado, la fecha sirve para todos".
 *
 * Se consulta directo sobre ReservaEquipo (filtrando por su Reserva
 * asociada) en vez de sobre Reserva: así se obtiene de una sola consulta
 * exactamente CUÁLES equipoId chocan, sin tener que iterar uno por uno
 * — necesario para poder armar un mensaje de error que diga
 * específicamente qué equipo(s) están ocupados (ver crearReservaEnBaseDeDatos).
 *
 * "distinct" evita duplicados si, por algún motivo, un mismo equipo
 * apareciera en más de una reserva confirmada ese día (no debería pasar
 * en operación normal, pero no cuesta nada seguir siendo correctos si pasara).
 *
 * `excluirReservaId` se usa al confirmar una reserva para no compararla
 * contra sí misma.
 */
async function equiposOcupadosEnFecha(
  tx: Prisma.TransactionClient | typeof prisma,
  equipoIds: number[],
  fecha: Date,
  excluirReservaId?: number
): Promise<number[]> {
  const { inicio, fin } = rangoDelDia(fecha);

  const filas = await tx.reservaEquipo.findMany({
    where: {
      equipoId: { in: equipoIds },
      reserva: {
        estado: EstadoReserva.CONFIRMADA,
        fechaEvento: { gte: inicio, lt: fin },
        ...(excluirReservaId !== undefined ? { id: { not: excluirReservaId } } : {}),
      },
    },
    select: { equipoId: true },
    distinct: ["equipoId"],
  });

  return filas.map((fila) => fila.equipoId);
}

// Formato de email básico: alcanza para descartar strings claramente
// inválidos ("algo escrito sin @ o sin dominio"), sin intentar cubrir cada
// caso extremo de la spec de emails (eso queda para el envío real del
// correo, en un prompt siguiente).
const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Datos ya validados/normalizados de una reserva, comunes a los dos
// endpoints de creación (público y admin) — la única diferencia entre
// ambos es si "clienteEmail" puede faltar o no (ver validarDatosReserva).
interface DatosReservaValidados {
  clienteNombre: string;
  clienteTelefono: string;
  clienteEmail: string | null;
  horaInicio: string;
  horaFin: string;
  // Antes "equipoId: number" (un solo equipo). Ver el comentario del
  // encabezado del archivo: ahora son uno o varios, todos para el MISMO
  // evento (misma fecha/horario, validados una sola vez para todos).
  equipoIds: number[];
  fechaEvento: Date;
  notas: string | null;
  municipio: string;
  provinciaId: number;
}

// Valida los campos de entrada para crear una reserva. Devuelve el error
// como string (para responder 400) o los datos ya normalizados/parseados.
//
// "opciones.emailObligatorio" distingue los dos endpoints de creación:
// - true (endpoint público, POST /api/reservas): el cliente siempre debe
//   dejar un email válido, igual que antes de este cambio.
// - false (endpoint de admin, POST /api/reservas/admin): el email es
//   opcional — el admin puede estar registrando una reserva hecha en
//   persona o por WhatsApp, de la que todavía no tiene el correo del
//   cliente. Si se manda vacío o no se manda, la reserva queda con
//   clienteEmail = null (ver el comentario en prisma/schema.prisma sobre
//   qué implica eso más adelante: no se puede enviar su factura por
//   correo, pero sí generarla y descargar su PDF).
function validarDatosReserva(
  body: Record<string, unknown>,
  opciones: { emailObligatorio: boolean }
): { error: string } | { datos: DatosReservaValidados } {
  const {
    clienteNombre,
    clienteTelefono,
    clienteEmail,
    horaInicio,
    horaFin,
    equipoIds,
    fechaEvento,
    notas,
    municipio,
    provinciaId,
  } = body as Record<string, unknown>;

  if (typeof clienteNombre !== "string" || !clienteNombre.trim()) {
    return { error: "El campo 'clienteNombre' es obligatorio y debe ser texto." };
  }

  if (typeof clienteTelefono !== "string" || !clienteTelefono.trim()) {
    return { error: "El campo 'clienteTelefono' es obligatorio y debe ser texto." };
  }

  // Ver el comentario de "opciones.emailObligatorio" arriba de la función.
  let clienteEmailNormalizado: string | null;
  if (opciones.emailObligatorio) {
    if (typeof clienteEmail !== "string" || !FORMATO_EMAIL.test(clienteEmail.trim())) {
      return { error: "El campo 'clienteEmail' es obligatorio y debe tener un formato de email válido." };
    }
    clienteEmailNormalizado = clienteEmail.trim();
  } else if (
    clienteEmail === undefined ||
    clienteEmail === null ||
    (typeof clienteEmail === "string" && clienteEmail.trim() === "")
  ) {
    // No se mandó (o vino vacío): queda sin email, es un caso válido en
    // el endpoint de admin.
    clienteEmailNormalizado = null;
  } else if (typeof clienteEmail === "string" && FORMATO_EMAIL.test(clienteEmail.trim())) {
    clienteEmailNormalizado = clienteEmail.trim();
  } else {
    // Se mandó algo, pero no tiene forma de email: se rechaza igual que
    // en el endpoint público, en vez de guardar basura silenciosamente.
    return { error: "El campo 'clienteEmail', si se incluye, debe tener un formato de email válido." };
  }

  if (typeof horaInicio !== "string" || !FORMATO_HORA.test(horaInicio)) {
    return { error: "El campo 'horaInicio' es obligatorio y debe tener el formato 'HH:mm' (ej. '18:00')." };
  }
  if (typeof horaFin !== "string" || !FORMATO_HORA.test(horaFin)) {
    return { error: "El campo 'horaFin' es obligatorio y debe tener el formato 'HH:mm' (ej. '22:00')." };
  }
  if (horaAMinutos(horaFin) <= horaAMinutos(horaInicio)) {
    return { error: "El campo 'horaFin' debe ser una hora posterior a 'horaInicio'." };
  }

  // "equipoIds": array con al menos un id de equipo. Antes era un solo
  // "equipoId" numérico; ver el comentario del encabezado del archivo.
  if (!Array.isArray(equipoIds) || equipoIds.length === 0) {
    return { error: "El campo 'equipoIds' es obligatorio y debe ser un array con al menos un equipo." };
  }
  const equipoIdsNumericos: number[] = [];
  for (const valorEquipoId of equipoIds) {
    const numerico = Number(valorEquipoId);
    if (!Number.isInteger(numerico)) {
      return { error: "Cada elemento de 'equipoIds' debe ser un número entero." };
    }
    equipoIdsNumericos.push(numerico);
  }
  // Deduplicado silencioso (no un error): si el mismo id llega repetido
  // (ej. un doble clic del lado del cliente), no hay ninguna ambigüedad
  // real en tratarlo como "este equipo, una vez" — la tabla intermedia
  // ReservaEquipo tampoco permite la misma combinación reserva+equipo
  // dos veces (ver el @@unique en prisma/schema.prisma).
  const equipoIdsUnicos = Array.from(new Set(equipoIdsNumericos));

  if (typeof fechaEvento !== "string" && typeof fechaEvento !== "number") {
    return { error: "El campo 'fechaEvento' es obligatorio." };
  }
  const fechaEventoParseada = new Date(fechaEvento);
  if (Number.isNaN(fechaEventoParseada.getTime())) {
    return { error: "El campo 'fechaEvento' no es una fecha válida." };
  }

  // No se permite reservar para una fecha que ya pasó. Se compara por día
  // completo (no por hora exacta): se puede reservar "hoy" aunque ya sean
  // las 11pm, porque lo que importa es el día del evento, no la hora.
  const { inicio: inicioFechaEvento } = rangoDelDia(fechaEventoParseada);
  const { inicio: inicioHoy } = rangoDelDia(new Date());
  if (inicioFechaEvento < inicioHoy) {
    return { error: "El campo 'fechaEvento' no puede ser una fecha pasada." };
  }

  if (notas !== undefined && notas !== null && typeof notas !== "string") {
    return { error: "El campo 'notas' debe ser texto." };
  }

  // El precio del equipo NO incluye viaje ni dieta (ver el modelo
  // Provincia): sin saber a qué provincia/municipio va el evento no se
  // puede cotizar el viaje después, así que ambos campos son obligatorios.
  if (typeof municipio !== "string" || !municipio.trim()) {
    return { error: "El campo 'municipio' es obligatorio y debe ser texto." };
  }

  const provinciaIdNumerico = Number(provinciaId);
  if (!Number.isInteger(provinciaIdNumerico)) {
    return { error: "El campo 'provinciaId' es obligatorio y debe ser un número entero." };
  }

  return {
    datos: {
      clienteNombre: clienteNombre.trim(),
      clienteTelefono: clienteTelefono.trim(),
      clienteEmail: clienteEmailNormalizado,
      horaInicio,
      horaFin,
      equipoIds: equipoIdsUnicos,
      fechaEvento: fechaEventoParseada,
      notas: typeof notas === "string" ? notas.trim() : null,
      municipio: municipio.trim(),
      provinciaId: provinciaIdNumerico,
    },
  };
}

// Lógica compartida por los dos endpoints de creación (público y admin),
// una vez que los datos YA pasaron validarDatosReserva: revisa que TODOS
// los equipos y la provincia existan, que NINGUNO de los equipos esté
// ocupado esa fecha, y crea la reserva PENDIENTE junto con sus filas de
// ReservaEquipo. Escribe la respuesta directo en "res" (en vez de
// devolver un resultado para que cada endpoint lo traduzca) porque ambos
// endpoints responden EXACTAMENTE igual ante cada caso (mismos códigos
// HTTP, mismos mensajes) — no hay nada que uno necesite manejar
// distinto del otro.
async function crearReservaEnBaseDeDatos(datos: DatosReservaValidados, res: Response): Promise<void> {
  const { equipoIds, fechaEvento, provinciaId } = datos;

  // --- Todos los equipos deben existir ---
  const equiposExistentes = await prisma.equipo.findMany({ where: { id: { in: equipoIds } } });
  if (equiposExistentes.length !== equipoIds.length) {
    const idsExistentes = new Set(equiposExistentes.map((equipo) => equipo.id));
    const idsFaltantes = equipoIds.filter((id) => !idsExistentes.has(id));
    res.status(404).json({
      error: `No existe equipo con id ${idsFaltantes.join(", ")}.`,
    });
    return;
  }

  const provincia = await prisma.provincia.findUnique({ where: { id: provinciaId } });
  if (!provincia) {
    res.status(404).json({ error: `No existe una provincia con id ${provinciaId}.` });
    return;
  }

  // --- REGLA DE NEGOCIO CLAVE: TODOS los equipos deben estar libres esa
  // fecha, no solo alguno. Si uno o más ya están confirmados ese día, se
  // rechaza la solicitud COMPLETA (no tendría sentido crear una reserva
  // "a medias", con unos equipos sí y otros no) e indicando por NOMBRE
  // cuáles son, para que el frontend pueda mostrar un mensaje claro
  // (ej. "La Consola X ya está ocupada esa fecha") en vez de un genérico
  // "algo salió mal". ---
  const idsOcupados = await equiposOcupadosEnFecha(prisma, equipoIds, fechaEvento);
  if (idsOcupados.length > 0) {
    const nombresOcupados = equiposExistentes
      .filter((equipo) => idsOcupados.includes(equipo.id))
      .map((equipo) => equipo.nombre);
    res.status(409).json({
      error: `Ya hay una reserva confirmada para esa fecha con: ${nombresOcupados.join(", ")}. Elige otra fecha o quita ese equipo de la solicitud.`,
      // Los ids ocupados van aparte del mensaje de texto (pensado para
      // mostrarse tal cual), para que el frontend también pueda, si
      // quiere, resaltar puntualmente esos equipos en su propia UI sin
      // tener que "parsear" el mensaje.
      equiposOcupados: idsOcupados,
    });
    return;
  }

  // Mismo criterio que antes (ver el comentario histórico que seguía
  // acá sobre el bug de Prisma con "clienteEmail: null"): las relaciones
  // se escriben EXPLÍCITAMENTE con "connect"/"create" en vez de dejar
  // que el cliente adivine el formato a partir de ids sueltos en el
  // objeto — ahora además es la única forma de crear, en la misma
  // llamada, las N filas de ReservaEquipo (una por cada equipo elegido).
  const { equipoIds: _equipoIds, provinciaId: _provinciaId, ...datosSinIds } = datos;
  const reserva = await prisma.reserva.create({
    data: {
      ...datosSinIds,
      estado: EstadoReserva.PENDIENTE,
      provincia: { connect: { id: provinciaId } },
      equipos: { create: equipoIds.map((equipoId) => ({ equipoId })) },
    },
    include: { equipos: { include: { equipo: true } }, provincia: true },
  });

  res.status(201).json(reserva);
}

/**
 * POST /api/reservas
 * Endpoint público: cualquier cliente puede pedir uno o varios equipos
 * para el mismo evento (misma fecha/horario). La reserva se crea
 * PENDIENTE (no bloquea nada); solo se rechaza de una vez si YA hay una
 * reserva CONFIRMADA para ese mismo día con alguno de los equipos
 * pedidos. El email del cliente es obligatorio aquí (ver validarDatosReserva).
 */
export async function crearReserva(req: Request, res: Response): Promise<void> {
  const resultado = validarDatosReserva(req.body, { emailObligatorio: true });

  if ("error" in resultado) {
    res.status(400).json({ error: resultado.error });
    return;
  }

  await crearReservaEnBaseDeDatos(resultado.datos, res);
}

/**
 * POST /api/reservas/admin
 * Endpoint exclusivo del admin (ver reserva.routes.ts): registra una
 * reserva hecha "a mano" para un cliente que reservó en persona o por
 * WhatsApp, en vez de usar el formulario público. Mismas validaciones y
 * mismo resultado (PENDIENTE) que el endpoint público, salvo que el email
 * del cliente es OPCIONAL (ver validarDatosReserva): si no se manda, la
 * reserva queda con clienteEmail = null.
 */
export async function crearReservaAdmin(req: Request, res: Response): Promise<void> {
  const resultado = validarDatosReserva(req.body, { emailObligatorio: false });

  if ("error" in resultado) {
    res.status(400).json({ error: resultado.error });
    return;
  }

  await crearReservaEnBaseDeDatos(resultado.datos, res);
}

/**
 * GET /api/reservas
 * Panel de admin: lista todas las reservas, con filtros opcionales por
 * estado (?estado=PENDIENTE) y/o equipo (?equipoId=5).
 */
export async function listarReservas(req: Request, res: Response): Promise<void> {
  const { estado, equipoId } = req.query;

  const where: ReservaWhereInput = {};

  if (estado !== undefined) {
    if (typeof estado !== "string" || !Object.values(EstadoReserva).includes(estado as EstadoReserva)) {
      res.status(400).json({
        error: `El query param 'estado' debe ser uno de: ${Object.values(EstadoReserva).join(", ")}.`,
      });
      return;
    }
    where.estado = estado as EstadoReserva;
  }

  if (equipoId !== undefined) {
    const equipoIdNumerico = Number(equipoId);
    if (!Number.isInteger(equipoIdNumerico)) {
      res.status(400).json({ error: "El query param 'equipoId' debe ser un número entero." });
      return;
    }
    // Ya no existe la columna Reserva.equipoId: ahora se filtra a través de
    // la tabla intermedia ReservaEquipo, buscando reservas que tengan AL
    // MENOS una fila con ese equipo.
    where.equipos = { some: { equipoId: equipoIdNumerico } };
  }

  const reservas = await prisma.reserva.findMany({
    where,
    // "equipos" es ahora una lista (ReservaEquipo[]); se incluye el equipo
    // real de cada fila para que el panel de admin siga viendo nombre/precio.
    include: { equipos: { include: { equipo: true } }, provincia: true },
    orderBy: { createdAt: "desc" },
  });

  res.status(200).json(reservas);
}

/**
 * GET /api/reservas/calendario?mes=9&anio=2026
 * Panel de admin: todas las reservas CONFIRMADAS cuya fechaEvento cae
 * dentro del mes/año indicado, con el equipo/provincia de cada una ya
 * incluidos — es lo que necesita la vista de calendario mensual (ver
 * src/app/admin/calendario/page.tsx en el frontend) para pintar un
 * indicador en cada día con eventos y mostrar el detalle logístico
 * (cliente, teléfono, equipos, horario, ubicación) al hacer clic.
 *
 * Solo CONFIRMADA: una reserva PENDIENTE o RECHAZADA no representa un
 * evento real todavía comprometido (mismo criterio de "fecha ocupada" que
 * el resto de este archivo, ver el comentario del encabezado).
 *
 * "mes" (1-12) y "anio" son opcionales: si no se mandan, se usa el mes y
 * año ACTUALES del servidor — así el panel puede pedir "el calendario de
 * este mes" sin que el frontend tenga que calcular la fecha de hoy por su
 * cuenta al cargar la página por primera vez.
 */
export async function obtenerCalendarioReservas(req: Request, res: Response): Promise<void> {
  const ahora = new Date();
  const { mes, anio } = req.query;

  // "?? " no sirve acá porque un query param ausente llega como
  // "undefined" (correcto para el default), pero uno presente siempre
  // llega como string, nunca como número — de ahí el Number(...) antes de
  // decidir si son válidos.
  const mesNumerico = mes !== undefined ? Number(mes) : ahora.getUTCMonth() + 1;
  const anioNumerico = anio !== undefined ? Number(anio) : ahora.getUTCFullYear();

  if (!Number.isInteger(mesNumerico) || mesNumerico < 1 || mesNumerico > 12) {
    res.status(400).json({ error: "El query param 'mes' debe ser un número entero entre 1 y 12." });
    return;
  }
  if (!Number.isInteger(anioNumerico)) {
    res.status(400).json({ error: "El query param 'anio' debe ser un número entero." });
    return;
  }

  const { inicio, fin } = rangoDelMes(mesNumerico, anioNumerico);

  const reservas = await prisma.reserva.findMany({
    where: {
      estado: EstadoReserva.CONFIRMADA,
      fechaEvento: { gte: inicio, lt: fin },
    },
    include: { equipos: { include: { equipo: true } }, provincia: true },
    orderBy: { fechaEvento: "asc" },
  });

  res.status(200).json(reservas);
}

/**
 * GET /api/reservas/:id
 * Detalle de una reserva puntual (panel de admin).
 */
export async function obtenerReserva(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "El id de la reserva debe ser un número entero." });
    return;
  }

  const reserva = await prisma.reserva.findUnique({
    where: { id },
    include: { equipos: { include: { equipo: true } }, provincia: true },
  });

  if (!reserva) {
    res.status(404).json({ error: "Reserva no encontrada." });
    return;
  }

  res.status(200).json(reserva);
}

/**
 * PATCH /api/reservas/:id/estado
 * Único lugar donde una reserva pasa de PENDIENTE a CONFIRMADA o RECHAZADA.
 *
 * Al confirmar, se vuelve a chequear el conflicto de fecha DENTRO de una
 * transacción con aislamiento "Serializable": esto evita que, si dos
 * reservas pendientes que comparten al menos un equipo/fecha se confirman
 * casi al mismo tiempo, ambas terminen CONFIRMADA (condición de carrera).
 * Ahora la reserva puede tener VARIOS equipos, así que el chequeo revisa
 * TODOS los equipos de la reserva (equiposOcupadosEnFecha), no solo uno.
 * Si Postgres detecta ese choque, aborta una de las dos transacciones con
 * un error de serialización, que acá se traduce a 409 igual que un
 * conflicto detectado a mano.
 */
export async function actualizarEstadoReserva(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const { estado } = req.body as { estado?: unknown };

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "El id de la reserva debe ser un número entero." });
    return;
  }

  if (estado !== EstadoReserva.CONFIRMADA && estado !== EstadoReserva.RECHAZADA) {
    res.status(400).json({
      error: "El campo 'estado' debe ser 'CONFIRMADA' o 'RECHAZADA' (no se puede volver a PENDIENTE manualmente).",
    });
    return;
  }

  try {
    const reserva = await prisma.$transaction(
      async (tx) => {
        // Se incluyen los equipos de la reserva porque el chequeo de
        // conflicto de fecha (más abajo) necesita la lista completa de
        // equipoId, ya no un único equipoId escalar.
        const reservaActual = await tx.reserva.findUnique({
          where: { id },
          include: { equipos: true },
        });
        if (!reservaActual) {
          throw new ReservaNoEncontradaError();
        }

        // Solo al CONFIRMAR se revisa el choque de fechas: rechazar una
        // reserva siempre es seguro, nunca "ocupa" ni "libera" nada más.
        if (estado === EstadoReserva.CONFIRMADA) {
          const idsEquipos = reservaActual.equipos.map((reservaEquipo) => reservaEquipo.equipoId);
          const idsOcupados = await equiposOcupadosEnFecha(
            tx,
            idsEquipos,
            reservaActual.fechaEvento,
            reservaActual.id
          );
          if (idsOcupados.length > 0) {
            throw new FechaNoDisponibleError();
          }
        }

        return tx.reserva.update({
          where: { id },
          data: { estado },
          include: { equipos: { include: { equipo: true } }, provincia: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    res.status(200).json(reserva);
  } catch (error) {
    if (error instanceof ReservaNoEncontradaError) {
      res.status(404).json({ error: "Reserva no encontrada." });
      return;
    }
    if (error instanceof FechaNoDisponibleError) {
      res.status(409).json({
        error:
          "Uno o más equipos de esta reserva ya tienen otra reserva confirmada para esa fecha. Rechaza esta reserva o elige otra fecha.",
      });
      return;
    }
    // P2034: Postgres detectó un conflicto de escritura por la carrera entre
    // dos confirmaciones simultáneas (aislamiento Serializable). Se trata
    // igual que un conflicto de fecha detectado a mano.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      res.status(409).json({
        error: "No se pudo confirmar por una actualización simultánea. Intenta de nuevo.",
      });
      return;
    }
    throw error;
  }
}

/**
 * DELETE /api/reservas/:id
 * Borrado administrativo (ej. reservas de prueba o duplicadas). A diferencia
 * de rechazar, esto elimina el registro por completo, sin dejar rastro en
 * el historial.
 */
export async function eliminarReserva(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "El id de la reserva debe ser un número entero." });
    return;
  }

  try {
    await prisma.reserva.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      res.status(404).json({ error: "Reserva no encontrada." });
      return;
    }
    throw error;
  }
}
