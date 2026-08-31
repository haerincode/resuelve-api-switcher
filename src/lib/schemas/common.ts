import { z } from "zod";
import { validateToml, tomlToMcpServer } from "@/utils/tomlUtils";

/**
 * Analiza errores de sintaxis JSON, retorna información de posición más amigable.
 */
function parseJsonError(error: unknown): string {
  if (!(error instanceof SyntaxError)) {
    return "Error de formato JSON";
  }

  const message = error.message || "Fallo al analizar JSON";

  // Chrome/V8: "Unexpected token ... in JSON at position 123"
  const positionMatch = message.match(/at position (\d+)/i);
  if (positionMatch) {
    const position = parseInt(positionMatch[1], 10);
    return `Error de formato JSON (posición: ${position})`;
  }

  // Firefox: "JSON.parse: unexpected character at line 1 column 23"
  const lineColumnMatch = message.match(/line (\d+) column (\d+)/i);
  if (lineColumnMatch) {
    const line = lineColumnMatch[1];
    const column = lineColumnMatch[2];
    return `Error de formato JSON: línea ${line}, columna ${column}`;
  }

  return `Error de formato JSON: ${message}`;
}

/**
 * Validación de texto de configuración JSON genérica:
 * - No vacío
 * - Parseable y es objeto (no array)
 */
export const jsonConfigSchema = z
  .string()
  .min(1, "La configuración no puede estar vacía")
  .superRefine((value, ctx) => {
    try {
      const obj = JSON.parse(value);
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Debe ser un objeto de configuración único",
        });
      }
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: parseJsonError(e),
      });
    }
  });

/**
 * Validación de texto de configuración TOML genérica:
 * - Permite vacío (la lógica de negocio de nivel superior decide si es obligatorio)
 * - Sintaxis y estructura válidas
 * - Avisos para campos requeridos de stdio/http/sse (command/url)
 */
export const tomlConfigSchema = z.string().superRefine((value, ctx) => {
  const err = validateToml(value);
  if (err) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `TOML inválido: ${err}`,
    });
    return;
  }

  if (!value.trim()) return;

  try {
    const server = tomlToMcpServer(value);
    if (server.type === "stdio" && !server.command?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "El tipo stdio requiere llenar command",
      });
    }
    if (
      (server.type === "http" || server.type === "sse") &&
      !server.url?.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `El tipo ${server.type} requiere llenar url`,
      });
    }
  } catch (e: any) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: e?.message || "Fallo al analizar TOML",
    });
  }
});
