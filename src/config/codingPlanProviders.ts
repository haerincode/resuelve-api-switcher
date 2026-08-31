/**
 * Tabla de enrutamiento base_url para proveedores de Coding Plan.
 *
 * Mantener consistencia con el backend `src-tauri/src/services/coding_plan.rs::detect_provider`:
 * El backend usa `url.contains(...)` para comparación de subcadenas, el frontend usa RegExp para coincidencia equivalente.
 * Al agregar un nuevo proveedor, cambiar solo este lugar (desplegable UsageScriptModal + useProviderActions
 * inyección automática al crear + reconocimiento en bandeja del sistema, todo reutilizado).
 */
import { createUsageScript } from "@/types";
import { TEMPLATE_TYPES } from "@/config/constants";

export interface CodingPlanProviderEntry {
  /** Alineado con el valor `codingPlanProvider` del QuotaTier del backend */
  id: "kimi" | "zhipu" | "minimax";
  /** Usado para el desplegable en UsageScriptModal */
  label: string;
  /** Regla de coincidencia base_url */
  pattern: RegExp;
}

export const CODING_PLAN_PROVIDERS: readonly CodingPlanProviderEntry[] = [
  { id: "kimi", label: "Kimi For Coding", pattern: /api\.kimi\.com\/coding/i },
  {
    id: "zhipu",
    label: "Zhipu GLM (智谱)",
    pattern: /bigmodel\.cn|api\.z\.ai/i,
  },
  {
    id: "minimax",
    label: "MiniMax",
    pattern: /api\.minimaxi?\.com|api\.minimax\.io/i,
  },
] as const;

/** Detecta automáticamente el proveedor de Coding Plan según la Base URL; retorna null si no hay coincidencia */
export function detectCodingPlanProvider(
  baseUrl: string | undefined | null,
): CodingPlanProviderEntry["id"] | null {
  if (!baseUrl) return null;
  for (const cp of CODING_PLAN_PROVIDERS) {
    if (cp.pattern.test(baseUrl)) return cp.id;
  }
  return null;
}

/**
 * Al crear un proveedor de Claude, si `ANTHROPIC_BASE_URL` coincide con la tabla de enrutamiento de Coding Plan,
 * marca automáticamente `meta.usage_script` como token_plan y lo habilita.
 *
 * - Solo inyecta cuando `meta.usage_script` está completamente ausente, no sobrescribe configuración existente del usuario/UsageScriptModal
 * - Solo aplica a la app Claude: la rama token_plan del backend `commands/provider.rs` solo procesa el supplier Claude
 *   `settings_config.env.ANTHROPIC_BASE_URL`
 * - code vacío: el lado Rust usa `coding_plan::get_coding_plan_quota` dedicado, no ejecuta script JS
 */
export function injectCodingPlanUsageScript<
  T extends {
    settingsConfig?: Record<string, any>;
    meta?: Record<string, any>;
  },
>(appId: string, provider: T): T {
  if (appId !== "claude") return provider;
  if (provider.meta?.usage_script) return provider;

  const baseUrl = provider.settingsConfig?.env?.ANTHROPIC_BASE_URL;
  const codingPlanProvider = detectCodingPlanProvider(
    typeof baseUrl === "string" ? baseUrl : null,
  );
  if (!codingPlanProvider) return provider;

  return {
    ...provider,
    meta: {
      ...(provider.meta ?? {}),
      usage_script: createUsageScript({
        enabled: true,
        templateType: TEMPLATE_TYPES.TOKEN_PLAN,
        codingPlanProvider,
      }),
    },
  };
}
