/**
 * 统一供应商（Universal Provider）预设配置
 *
 * 统一供应商是跨应用共享的配置，修改后会自动同步到 Claude、Codex、Gemini 三个应用。
 * 适用于 NewAPI 等支持多种协议的 API 网关。
 */

import type {
  UniversalProvider,
  UniversalProviderApps,
  UniversalProviderModels,
} from "@/types";

/**
 * 统一供应商预设接口
 */
export interface UniversalProviderPreset {
  /** 预设名称 */
  name: string;
  /** 供应商类型标识 */
  providerType: string;
  /** 默认启用的应用 */
  defaultApps: UniversalProviderApps;
  /** 默认模型配置 */
  defaultModels: UniversalProviderModels;
  /** 网站链接 */
  websiteUrl?: string;
  /** 图标名称 */
  icon?: string;
  /** 图标颜色 */
  iconColor?: string;
  /** 描述 */
  description?: string;
  /** 是否为自定义模板（允许用户完全自定义） */
  isCustomTemplate?: boolean;
}

/**
 * NewAPI 默认模型配置
 */
const RESUELVE_API_DEFAULT_MODELS: UniversalProviderModels = {
  claude: {
    model: "claude-sonnet-5",
    haikuModel: "claude-sonnet-5",
    sonnetModel: "claude-sonnet-5",
    opusModel: "claude-opus-5",
  },
  codex: {
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
  },
  gemini: {
    model: "gemini-3.7-flash",
  },
};

/**
 * 统一供应商预设列表
 */
export const universalProviderPresets: UniversalProviderPreset[] = [
  {
    name: "Resuelve-API (Alta Velocidad)",
    providerType: "newapi",
    defaultApps: {
      claude: true,
      codex: true,
      gemini: true,
    },
    defaultModels: RESUELVE_API_DEFAULT_MODELS,
    websiteUrl: "https://resuelve-api-f47v.onrender.com",
    icon: "anthropic",
    iconColor: "#38BDF8",
    description:
      "Una sola clave para Claude Code, Codex y Gemini CLI a la vez",
  },
  {
    name: "Pasarela personalizada",
    providerType: "custom_gateway",
    defaultApps: {
      claude: true,
      codex: true,
      gemini: true,
    },
    defaultModels: RESUELVE_API_DEFAULT_MODELS,
    icon: "openai",
    iconColor: "#6366F1",
    description: "Configura manualmente la dirección y los modelos",
    isCustomTemplate: true,
  },
];

/**
 * 根据预设创建统一供应商
 */
export function createUniversalProviderFromPreset(
  preset: UniversalProviderPreset,
  id: string,
  baseUrl: string,
  apiKey: string,
  customName?: string,
): UniversalProvider {
  return {
    id,
    name: customName || preset.name,
    providerType: preset.providerType,
    apps: { ...preset.defaultApps },
    baseUrl,
    apiKey,
    models: JSON.parse(JSON.stringify(preset.defaultModels)), // Deep copy
    websiteUrl: preset.websiteUrl,
    icon: preset.icon,
    iconColor: preset.iconColor,
    createdAt: Date.now(),
  };
}

/**
 * 获取预设的显示名称（用于 UI）
 */
export function getPresetDisplayName(preset: UniversalProviderPreset): string {
  return preset.name;
}

/**
 * 根据类型查找预设
 */
export function findPresetByType(
  providerType: string,
): UniversalProviderPreset | undefined {
  return universalProviderPresets.find((p) => p.providerType === providerType);
}
