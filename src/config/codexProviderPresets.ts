/**
 * Plantillas de proveedores predefinidos para Codex
 */
import { ProviderCategory } from "../types";
import type { CodexApiFormat } from "../types";
import type { PresetTheme } from "./claudeProviderPresets";

export interface CodexProviderPreset {
  name: string;
  nameKey?: string; // clave i18n para el nombre localizado
  websiteUrl: string;
  // Los proveedores de terceros pueden ofrecer un enlace propio para obtener la API Key
  apiKeyUrl?: string;
  auth: Record<string, any>; // se escribe en ~/.codex/auth.json
  config: string; // se escribe en ~/.codex/config.toml (cadena TOML)
  isOfficial?: boolean; // indica si es un preset oficial
  isPartner?: boolean; // indica si es un socio comercial
  partnerPromotionKey?: string; // clave i18n del texto promocional del socio
  category?: ProviderCategory; // categoría del proveedor
  isCustomTemplate?: boolean; // indica si es una plantilla personalizada
  // Lista de endpoints candidatos (para gestión de direcciones y test de velocidad)
  endpointCandidates?: string[];
  // Configuración del tema visual
  theme?: PresetTheme;
  // Configuración del icono
  icon?: string; // nombre del icono
  iconColor?: string; // color del icono
  // Formato de la API de Codex
  apiFormat?: CodexApiFormat;
}

/**
 * Puerto por defecto del router local del switcher (proxy/types.rs: listen_port).
 * Codex apunta aquí para que las peticiones pasen por el router y se registre el uso.
 */
export const LOCAL_ROUTER_BASE_URL = "http://127.0.0.1:15721/v1";

/**
 * Genera el auth.json de un proveedor de terceros.
 * La clave vive aquí, no en config.toml: el campo "API Key" del formulario escribe
 * OPENAI_API_KEY y config.toml solo la referencia.
 */
export function generateThirdPartyAuth(apiKey: string): Record<string, any> {
  return {
    OPENAI_API_KEY: apiKey || "",
  };
}

/**
 * Genera el config.toml de un proveedor de terceros.
 *
 * @param providerName    Identificador de la sección TOML (se normaliza a snake_case).
 * @param baseUrl         Endpoint que usará Codex.
 * @param modelName       Modelo por defecto.
 * @param apiKey          Se deja vacío en los presets: lo rellena el formulario.
 * @param displayName     Nombre visible del proveedor. Si se omite se usa el identificador.
 */
export function generateThirdPartyConfig(
  providerName: string,
  baseUrl: string,
  modelName = "gpt-5.4",
  apiKey = "",
  displayName?: string,
): string {
  // Se limpia el nombre para que cumpla las reglas de claves TOML.
  const cleanProviderName =
    providerName
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/^_+|_+$/g, "") || "custom";

  return `model_provider = "${cleanProviderName}"
model = "${modelName}"
model_reasoning_effort = "high"
disable_response_storage = true

[model_providers.${cleanProviderName}]
name = "${displayName || cleanProviderName}"
base_url = "${baseUrl}"
wire_api = "responses"
api_key = "${apiKey}"`;
}

export const codexProviderPresets: CodexProviderPreset[] = [
  {
    name: "Resuelve-API (Alta Velocidad)",
    websiteUrl: "https://resuelve-api-f47v.onrender.com",
    apiKeyUrl: "https://resuelve-api-f47v.onrender.com",
    category: "third_party",
    auth: generateThirdPartyAuth(""),
    config: generateThirdPartyConfig(
      "resuelve_api",
      LOCAL_ROUTER_BASE_URL,
      "gpt-5.6-terra",
      "",
      "Resuelve-API",
    ),
    endpointCandidates: [
      LOCAL_ROUTER_BASE_URL,
      "https://resuelve-api-f47v.onrender.com/v1",
    ],
    theme: {
      icon: "codex",
      backgroundColor: "#38BDF8",
      textColor: "#FFFFFF",
    },
    icon: "openai",
    iconColor: "#38BDF8",
  },
  {
    name: "OpenAI Official",
    websiteUrl: "https://chatgpt.com/codex",
    isOfficial: true,
    category: "official",
    auth: {},
    config: ``,
    theme: {
      icon: "codex",
      backgroundColor: "#1F2937", // gray-800
      textColor: "#FFFFFF",
    },
    icon: "openai",
    iconColor: "#00A67E",
  },
];
