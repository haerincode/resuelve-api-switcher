import type { ProviderCategory } from "@/types";

/**
 * Configuración de tema visual para proveedores preestablecidos de Gemini
 */
export interface GeminiPresetTheme {
  /** Tipo de icono: 'gemini' | 'generic' */
  icon?: "gemini" | "generic";
  /** Color de fondo (estado seleccionado), soporta color hex */
  backgroundColor?: string;
  /** Color de texto (estado seleccionado), soporta color hex */
  textColor?: string;
}

export interface GeminiProviderPreset {
  name: string;
  nameKey?: string; // i18n key for localized display name
  websiteUrl: string;
  apiKeyUrl?: string;
  settingsConfig: object;
  baseURL?: string;
  model?: string;
  description?: string;
  category?: ProviderCategory;
  isPartner?: boolean;
  partnerPromotionKey?: string;
  endpointCandidates?: string[];
  theme?: GeminiPresetTheme;
  // Configuración de icono
  icon?: string; // nombre del icono
  iconColor?: string; // color del icono
}

export const geminiProviderPresets: GeminiProviderPreset[] = [
  {
    name: "Resuelve-API (Alta Velocidad)",
    websiteUrl: "https://resuelve-api-f47v.onrender.com",
    apiKeyUrl: "https://resuelve-api-f47v.onrender.com",
    settingsConfig: {
      env: {
        GOOGLE_GEMINI_BASE_URL: "https://resuelve-api-f47v.onrender.com",
        GEMINI_MODEL: "gemini-3.7-flash",
      },
    },
    baseURL: "https://resuelve-api-f47v.onrender.com",
    model: "gemini-3.7-flash",
    description: "Resuelve-API (Alta Velocidad)",
    category: "third_party",
    endpointCandidates: ["https://resuelve-api-f47v.onrender.com"],
    theme: {
      icon: "gemini",
      backgroundColor: "#38BDF8",
      textColor: "#FFFFFF",
    },
    icon: "gemini",
    iconColor: "#38BDF8",
  },
  {
    name: "Google Official",
    websiteUrl: "https://ai.google.dev/",
    apiKeyUrl: "https://aistudio.google.com/apikey",
    settingsConfig: {
      env: {},
    },
    description: "Google Gemini API oficial (OAuth)",
    category: "official",
    partnerPromotionKey: "google-official",
    theme: {
      icon: "gemini",
      backgroundColor: "#4285F4",
      textColor: "#FFFFFF",
    },
    icon: "gemini",
    iconColor: "#4285F4",
  },
];

export function getGeminiPresetByName(
  name: string,
): GeminiProviderPreset | undefined {
  return geminiProviderPresets.find((preset) => preset.name === name);
}

export function getGeminiPresetByUrl(
  url: string,
): GeminiProviderPreset | undefined {
  if (!url) return undefined;
  return geminiProviderPresets.find(
    (preset) =>
      preset.baseURL &&
      url.toLowerCase().includes(preset.baseURL.toLowerCase()),
  );
}
