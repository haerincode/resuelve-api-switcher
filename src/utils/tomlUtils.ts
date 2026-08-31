import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { normalizeTomlText } from "@/utils/textNormalization";
import { McpServerSpec } from "../types";

/**
 * Validar formato TOML y convertir a objeto JSON
 * @param text Texto TOML
 * @returns Mensaje de error (cadena vacía indica éxito)
 */
export const validateToml = (text: string): string => {
  if (!text.trim()) return "";
  try {
    const normalized = normalizeTomlText(text);
    const parsed = parseToml(normalized);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "mustBeObject";
    }
    return "";
  } catch (e: any) {
    // Devolver mensaje de error subyacente, el nivel superior realizará el envoltorio i18n
    return e?.message || "parseError";
  }
};

/**
 * Convertir objeto McpServerSpec a cadena TOML
 * Usa stringify de @iarna/toml, maneja automáticamente escape y tablas anidadas
 * Preserva todos los campos (incluidos campos extendidos como timeout_ms)
 */
export const mcpServerToToml = (server: McpServerSpec): string => {
  // Primero copiar todos los campos (preservar campos extendidos)
  const obj: any = { ...server };

  // Eliminar campos indefinidos, asegurar una salida más limpia
  for (const k of Object.keys(obj)) {
    if (obj[k] === undefined) delete obj[k];
  }

  // stringify por defecto incluye saltos de línea, hacer un trim para adaptarse a la visualización en el cuadro de texto
  return stringifyToml(obj).trim();
};

/**
 * Convertir texto TOML a objeto McpServerSpec (configuración de servidor único)
 * Soporta dos formatos:
 * 1. Configuración directa de servidor (type, command, args, etc.)
 * 2. Formato [mcp_servers.<id>] (recomendado, toma el primer servidor)
 * 3. Formato erróneo [mcp.servers.<id>] (análisis tolerante a fallos, también toma el primer servidor)
 * @param tomlText Texto TOML
 * @returns Objeto McpServer
 * @throws Lanza error cuando falla el análisis o conversión
 */
export const tomlToMcpServer = (tomlText: string): McpServerSpec => {
  if (!tomlText.trim()) {
    throw new Error("El contenido TOML no puede estar vacío");
  }

  const parsed = parseToml(normalizeTomlText(tomlText));

  // Caso 1: Directamente es configuración de servidor (contiene campos type/command/url, etc.)
  if (
    parsed.type ||
    parsed.command ||
    parsed.url ||
    parsed.args ||
    parsed.env
  ) {
    return normalizeServerConfig(parsed);
  }

  // Caso 2: Formato [mcp_servers.<id>] (recomendado)
  if (parsed.mcp_servers && typeof parsed.mcp_servers === "object") {
    const serverIds = Object.keys(parsed.mcp_servers);
    if (serverIds.length > 0) {
      const firstServer = (parsed.mcp_servers as any)[serverIds[0]];
      return normalizeServerConfig(firstServer);
    }
  }

  // Caso 3: Formato erróneo [mcp.servers.<id>] (análisis tolerante a fallos)
  if (parsed.mcp && typeof parsed.mcp === "object") {
    const mcpObj = parsed.mcp as any;
    if (mcpObj.servers && typeof mcpObj.servers === "object") {
      const serverIds = Object.keys(mcpObj.servers);
      if (serverIds.length > 0) {
        const firstServer = mcpObj.servers[serverIds[0]];
        return normalizeServerConfig(firstServer);
      }
    }
  }

  throw new Error(
    "Formato TOML no reconocido. Por favor proporcione una configuración de servidor MCP único, o use el formato [mcp_servers.<id>]",
  );
};

/**
 * Normalizar objeto de configuración de servidor al formato McpServer
 * Preserva todos los campos (incluidos campos extendidos como timeout_ms)
 */
function normalizeServerConfig(config: any): McpServerSpec {
  if (!config || typeof config !== "object") {
    throw new Error("La configuración del servidor debe ser un objeto");
  }

  const type = (config.type as string) || "stdio";

  // Lista de campos conocidos (usada para exclusión posterior)
  const knownFields = new Set<string>();

  if (type === "stdio") {
    if (!config.command || typeof config.command !== "string") {
      throw new Error("El servidor MCP de tipo stdio debe contener el campo command");
    }

    const server: McpServerSpec = {
      type: "stdio",
      command: config.command,
    };
    knownFields.add("type");
    knownFields.add("command");

    // Campos opcionales
    if (config.args && Array.isArray(config.args)) {
      server.args = config.args.map((arg: any) => String(arg));
      knownFields.add("args");
    }
    if (config.env && typeof config.env === "object") {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(config.env)) {
        env[k] = String(v);
      }
      server.env = env;
      knownFields.add("env");
    }
    if (config.cwd && typeof config.cwd === "string") {
      server.cwd = config.cwd;
      knownFields.add("cwd");
    }

    // Preservar todos los campos desconocidos (como campos extendidos timeout_ms, etc.)
    for (const key of Object.keys(config)) {
      if (!knownFields.has(key)) {
        server[key] = config[key];
      }
    }

    return server;
  } else if (type === "http" || type === "sse") {
    if (!config.url || typeof config.url !== "string") {
      throw new Error(`El servidor MCP de tipo ${type} debe contener el campo url`);
    }

    const server: McpServerSpec = {
      type: type as "http" | "sse",
      url: config.url,
    };
    knownFields.add("type");
    knownFields.add("url");

    // Campos opcionales
    if (config.headers && typeof config.headers === "object") {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(config.headers)) {
        headers[k] = String(v);
      }
      server.headers = headers;
      knownFields.add("headers");
    }

    // Preservar todos los campos desconocidos
    for (const key of Object.keys(config)) {
      if (!knownFields.has(key)) {
        server[key] = config[key];
      }
    }

    return server;
  } else {
    throw new Error(`Tipo de servidor MCP no soportado: ${type}`);
  }
}

/**
 * Intentar extraer un ID/título de servidor razonable del TOML
 * @param tomlText Texto TOML
 * @returns ID sugerido, devuelve cadena vacía en caso de fallo
 */
export const extractIdFromToml = (tomlText: string): string => {
  try {
    const parsed = parseToml(normalizeTomlText(tomlText));

    // Intentar extraer ID de [mcp_servers.<id>] o [mcp.servers.<id>]
    if (parsed.mcp_servers && typeof parsed.mcp_servers === "object") {
      const serverIds = Object.keys(parsed.mcp_servers);
      if (serverIds.length > 0) {
        return serverIds[0];
      }
    }

    if (parsed.mcp && typeof parsed.mcp === "object") {
      const mcpObj = parsed.mcp as any;
      if (mcpObj.servers && typeof mcpObj.servers === "object") {
        const serverIds = Object.keys(mcpObj.servers);
        if (serverIds.length > 0) {
          return serverIds[0];
        }
      }
    }

    // Intentar inferir del command
    if (parsed.command && typeof parsed.command === "string") {
      const cmd = parsed.command.split(/[\\/]/).pop() || "";
      return cmd.replace(/\.(exe|bat|sh|js|py)$/i, "");
    }
  } catch {
    // Error de análisis, devolver vacío
  }

  return "";
};
