/**
 * Presets limpios - Resuelve-API Switcher
 */
import { ProviderCategory } from "../types";

export interface TemplateValueConfig {
  label: string;
  placeholder: string;
  defaultValue?: string;
  editorValue: string;
}

export interface PresetTheme {
  icon?: "claude" | "codex" | "gemini" | "generic";
  backgroundColor?: string;
  textColor?: string;
}

export interface ProviderPreset {
  name: string;
  nameKey?: string;
  websiteUrl: string;
  apiKeyUrl?: string;
  settingsConfig: object;
  isOfficial?: boolean;
  isPartner?: boolean;
  partnerPromotionKey?: string;
  category?: ProviderCategory;
  apiKeyField?: "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_API_KEY";
  templateValues?: Record<string, TemplateValueConfig>;
  endpointCandidates?: string[];
  theme?: PresetTheme;
  icon?: string;
  iconColor?: string;
  apiFormat?: "anthropic" | "openai_chat" | "openai_responses" | "gemini_native";
  providerType?: "github_copilot" | "codex_oauth";
  requiresOAuth?: boolean;
  hidden?: boolean;
  modelsUrl?: string;
}

export const providerPresets: ProviderPreset[] = [
  {
    name: "Resuelve-API (Alta Velocidad)",
    websiteUrl: "https://resuelve-api.lat",
    apiKeyUrl: "https://resuelve-api.lat",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://resuelve-api.lat/v1",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "claude-sonnet-5",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-5",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-5",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-sonnet-5",
      },
    },
    // No usar "official": esa categoría deshabilita el campo de Clave API.
    category: "third_party",
    endpointCandidates: ["https://resuelve-api.lat/v1"],
    theme: {
      icon: "claude",
      backgroundColor: "#38BDF8",
      textColor: "#FFFFFF",
    },
    icon: "anthropic",
    iconColor: "#38BDF8",
  },
  {
    name: "Claude Official",
    websiteUrl: "https://www.anthropic.com/claude-code",
    settingsConfig: {
      env: {},
    },
    category: "official",
    theme: {
      icon: "claude",
      backgroundColor: "#D97757",
      textColor: "#FFFFFF",
    },
    icon: "anthropic",
    iconColor: "#D4915D",
  },
];
