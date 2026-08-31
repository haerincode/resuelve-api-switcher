import { z } from "zod";

/**
 * Analiza errores de sintaxis JSON, extrae información de posición
 */
function parseJsonError(error: unknown): string {
  if (!(error instanceof SyntaxError)) {
    return "Error de formato JSON en la configuración";
  }

  const message = error.message;

  // Extraer información de posición: Chrome/V8: "Unexpected token ... in JSON at position 123"
  const positionMatch = message.match(/at position (\d+)/i);
  if (positionMatch) {
    const position = parseInt(positionMatch[1], 10);
    return `Error de formato JSON: ${message.split(" in JSON")[0]} (posición: ${position})`;
  }

  // Firefox: "JSON.parse: unexpected character at line 1 column 23"
  const lineColumnMatch = message.match(/line (\d+) column (\d+)/i);
  if (lineColumnMatch) {
    const line = lineColumnMatch[1];
    const column = lineColumnMatch[2];
    return `Error de formato JSON: línea ${line}, columna ${column}`;
  }

  // Caso general: extraer información clave del error
  const cleanMessage = message
    .replace(/^JSON\.parse:\s*/i, "")
    .replace(/^Unexpected\s+/i, "Inesperado ")
    .replace(/token/gi, "token")
    .replace(/Expected/gi, "Se esperaba");

  return `Error de formato JSON: ${cleanMessage}`;
}

export const providerSchema = z.object({
  name: z.string(), // Validación obligatoria movida a handleSubmit con mensaje toast
  websiteUrl: z.string().url("Por favor ingrese una URL válida").optional().or(z.literal("")),
  notes: z.string().optional(),
  settingsConfig: z
    .string()
    .min(1, "Por favor complete el contenido de configuración")
    .superRefine((value, ctx) => {
      try {
        JSON.parse(value);
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: parseJsonError(error),
        });
      }
    }),
  // Configuración de ícono
  icon: z.string().optional(),
  iconColor: z.string().optional(),
});

export type ProviderFormData = z.infer<typeof providerSchema>;
