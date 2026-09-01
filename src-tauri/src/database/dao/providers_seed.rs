//! 官方供应商种子数据
//!
//! 启动时调用 `Database::init_default_official_providers` 把这些条目
//! 写入 `providers` 表，让所有用户都能看到一个"一键切回官方"的入口。
//!
//! 字段与前端预设保持一致，参见：
//! - `src/config/claudeProviderPresets.ts`（"Claude Official"）
//! - `src/config/codexProviderPresets.ts`（"OpenAI Official"）
//! - `src/config/geminiProviderPresets.ts`（"Google Official"）

use crate::app_config::AppType;

pub(crate) const CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID: &str = "claude-desktop-official";

/// 单条官方供应商种子定义。
pub(crate) struct OfficialProviderSeed {
    pub id: &'static str,
    pub app_type: AppType,
    pub name: &'static str,
    pub website_url: &'static str,
    pub icon: &'static str,
    pub icon_color: &'static str,
    /// settings_config 的 JSON 字符串，每个 app 结构不同。
    pub settings_config_json: &'static str,
    /// Categoría con la que se inserta en la tabla `providers`.
    ///
    /// "official" = autenticación oficial sin API Key (el formulario deshabilita
    /// el campo de clave). Resuelve-API sí necesita clave, por eso usa
    /// "third_party".
    pub category: &'static str,
}

/// Claude / Claude Desktop / Codex / Gemini 的oficial presets + Resuelve-API como default.
///
/// id fijo, name directo (sin i18n).
pub(crate) const OFFICIAL_SEEDS: &[OfficialProviderSeed] = &[
    OfficialProviderSeed {
        id: "resuelve-api-official",
        app_type: AppType::Claude,
        name: "Resuelve-API (Alta Velocidad)",
        website_url: "https://resuelve-api.lat",
        icon: "anthropic",
        icon_color: "#38BDF8",
        settings_config_json: r#"{"env":{"ANTHROPIC_BASE_URL":"https://resuelve-api.lat/v1","ANTHROPIC_AUTH_TOKEN":"","ANTHROPIC_MODEL":"claude-sonnet-5","ANTHROPIC_DEFAULT_SONNET_MODEL":"claude-sonnet-5","ANTHROPIC_DEFAULT_OPUS_MODEL":"claude-opus-5","ANTHROPIC_DEFAULT_HAIKU_MODEL":"claude-sonnet-5"}}"#,
        // Necesita API Key: no puede ser "official" o el formulario deshabilita el campo.
        category: "third_party",
    },
    OfficialProviderSeed {
        id: "resuelve-api-codex",
        app_type: AppType::Codex,
        name: "Resuelve-API (Alta Velocidad)",
        website_url: "https://resuelve-api.lat",
        icon: "openai",
        icon_color: "#38BDF8",
        settings_config_json: "{\"auth\": {\"OPENAI_API_KEY\": \"\"}, \"config\": \"model_provider = \\\"resuelve_api\\\"\\nmodel = \\\"gpt-5.6-terra\\\"\\nmodel_reasoning_effort = \\\"high\\\"\\ndisable_response_storage = true\\n\\n[model_providers.resuelve_api]\\nname = \\\"Resuelve-API\\\"\\nbase_url = \\\"http://127.0.0.1:15721/v1\\\"\\nwire_api = \\\"responses\\\"\\napi_key = \\\"\\\"\\n\"}",
        category: "third_party",
    },
    OfficialProviderSeed {
        id: "resuelve-api-gemini",
        app_type: AppType::Gemini,
        name: "Resuelve-API (Alta Velocidad)",
        website_url: "https://resuelve-api.lat",
        icon: "gemini",
        icon_color: "#38BDF8",
        settings_config_json: "{\"env\": {\"GOOGLE_GEMINI_BASE_URL\": \"https://resuelve-api.lat\", \"GEMINI_MODEL\": \"gemini-3.7-flash\", \"GEMINI_API_KEY\": \"\"}, \"config\": {}}",
        category: "third_party",
    },
    OfficialProviderSeed {
        id: "claude-official",
        app_type: AppType::Claude,
        name: "Claude Official",
        website_url: "https://www.anthropic.com/claude-code",
        icon: "anthropic",
        icon_color: "#D4915D",
        settings_config_json: r#"{"env":{}}"#,
        category: "official",
    },
    OfficialProviderSeed {
        id: CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID,
        app_type: AppType::ClaudeDesktop,
        name: "Claude Desktop Official",
        website_url: "https://claude.ai/download",
        icon: "anthropic",
        icon_color: "#D4915D",
        // 空 env 只是占位；切换该 provider 时会恢复 Claude Desktop 1P 模式
        settings_config_json: r#"{"env":{}}"#,
        category: "official",
    },
    OfficialProviderSeed {
        id: "codex-official",
        app_type: AppType::Codex,
        name: "OpenAI Official",
        website_url: "https://chatgpt.com/codex",
        icon: "openai",
        icon_color: "#00A67E",
        // 空 auth + 空 config 让用户走 ChatGPT Plus/Pro OAuth
        settings_config_json: r#"{"auth":{},"config":""}"#,
        category: "official",
    },
    OfficialProviderSeed {
        id: "gemini-official",
        app_type: AppType::Gemini,
        name: "Google Official",
        website_url: "https://ai.google.dev/",
        icon: "gemini",
        icon_color: "#4285F4",
        // 空 env + 空 config 让用户走 Google OAuth
        settings_config_json: r#"{"env":{},"config":{}}"#,
        category: "official",
    },
];

/// 判断给定的 provider id 是否属于内置官方种子。
///
/// 单一事实源：直接扫描 `OFFICIAL_SEEDS`，避免在多处重复维护 id 列表。
pub(crate) fn is_official_seed_id(id: &str) -> bool {
    OFFICIAL_SEEDS.iter().any(|seed| seed.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn official_seeds_include_claude_desktop() {
        let seed = OFFICIAL_SEEDS
            .iter()
            .find(|seed| seed.id == CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID)
            .expect("claude desktop official seed");

        assert_eq!(seed.app_type, AppType::ClaudeDesktop);
        assert!(is_official_seed_id(CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID));
    }
}
