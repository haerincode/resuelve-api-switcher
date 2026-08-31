/**
 * Plantillas de configuración de Codex
 * Se usan como configuración por defecto al crear un proveedor personalizado
 */

export interface CodexTemplate {
  auth: Record<string, any>;
  config: string;
}

/**
 * Devuelve la plantilla personalizada de Codex.
 * La clave se escribe en auth.json (OPENAI_API_KEY); config.toml la referencia
 * mediante api_key, que el formulario rellena al guardar.
 */
export function getCodexCustomTemplate(): CodexTemplate {
  const config = `model_provider = "custom"
model = "gpt-5.4"
model_reasoning_effort = "high"
disable_response_storage = true

[model_providers.custom]
name = "custom"
wire_api = "responses"
api_key = ""`;

  return {
    auth: { OPENAI_API_KEY: "" },
    config,
  };
}
