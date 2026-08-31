//! Servicio de verificación de salud en streaming
//!
//! Usa API en streaming para verificación rápida de salud, solo necesita recibir primer chunk para determinar éxito.

use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::Instant;

use crate::app_config::AppType;
use crate::error::AppError;
use crate::provider::Provider;
use crate::proxy::gemini_url::{normalize_gemini_model_id, resolve_gemini_native_url};
use crate::proxy::providers::copilot_auth;
use crate::proxy::providers::transform::anthropic_to_openai;
use crate::proxy::providers::transform_gemini::anthropic_to_gemini;
use crate::proxy::providers::transform_responses::anthropic_to_responses;
use crate::proxy::providers::{
    get_adapter, AuthInfo, AuthStrategy, ClaudeAdapter, ProviderAdapter,
};

/// Enum de estado de salud
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum HealthStatus {
    Operational,
    Degraded,
    Failed,
}

/// Configuración de verificación en streaming
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamCheckConfig {
    pub timeout_secs: u64,
    pub max_retries: u32,
    pub degraded_threshold_ms: u64,
    /// Modelo de prueba Claude
    pub claude_model: String,
    /// Modelo de prueba Codex
    pub codex_model: String,
    /// Modelo de prueba Gemini
    pub gemini_model: String,
    /// Prompt de verificación
    #[serde(default = "default_test_prompt")]
    pub test_prompt: String,
}

fn default_test_prompt() -> String {
    "Who are you?".to_string()
}

impl Default for StreamCheckConfig {
    fn default() -> Self {
        Self {
            timeout_secs: 45,
            max_retries: 2,
            degraded_threshold_ms: 6000,
            claude_model: "claude-haiku-4-5-20251001".to_string(),
            codex_model: "gpt-5.4@low".to_string(),
            gemini_model: "gemini-3-flash-preview".to_string(),
            test_prompt: default_test_prompt(),
        }
    }
}

/// Resultado de verificación en streaming
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamCheckResult {
    pub status: HealthStatus,
    pub success: bool,
    pub message: String,
    pub response_time_ms: Option<u64>,
    pub http_status: Option<u16>,
    pub model_used: String,
    pub tested_at: i64,
    pub retry_count: u32,
    /// Clasificación de error de grano fino (como "modelNotFound"), frontend renderiza texto especializado según esto
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_category: Option<String>,
}

/// Servicio de verificación de salud en streaming
pub struct StreamCheckService;

impl StreamCheckService {
    /// Ejecuta verificación de salud en streaming (con reintentos)
    ///
    /// Si Provider configuró configuración de prueba separada (meta.testConfig), usa esa configuración para sobrescribir configuración global
    pub async fn check_with_retry(
        app_type: &AppType,
        provider: &Provider,
        config: &StreamCheckConfig,
        auth_override: Option<AuthInfo>,
        base_url_override: Option<String>,
        claude_api_format_override: Option<String>,
    ) -> Result<StreamCheckResult, AppError> {
        // Combina configuración separada de proveedor y configuración global
        let effective_config = Self::merge_provider_config(provider, config);
        let mut last_result = None;

        for attempt in 0..=effective_config.max_retries {
            let result = Self::check_once(
                app_type,
                provider,
                &effective_config,
                auth_override.clone(),
                base_url_override.clone(),
                claude_api_format_override.clone(),
            )
            .await;

            match &result {
                Ok(r) if r.success => {
                    return Ok(StreamCheckResult {
                        retry_count: attempt,
                        ..r.clone()
                    });
                }
                Ok(r) => {
                    // Falló pero no es anómalo, determina si reintentar
                    if Self::should_retry(&r.message) && attempt < effective_config.max_retries {
                        last_result = Some(r.clone());
                        continue;
                    }
                    return Ok(StreamCheckResult {
                        retry_count: attempt,
                        ..r.clone()
                    });
                }
                Err(e) => {
                    if Self::should_retry(&e.to_string()) && attempt < effective_config.max_retries
                    {
                        continue;
                    }
                    return Err(AppError::Message(e.to_string()));
                }
            }
        }

        Ok(last_result.unwrap_or_else(|| StreamCheckResult {
            status: HealthStatus::Failed,
            success: false,
            message: "Check failed".to_string(),
            response_time_ms: None,
            http_status: None,
            model_used: String::new(),
            tested_at: chrono::Utc::now().timestamp(),
            retry_count: effective_config.max_retries,
            error_category: None,
        }))
    }

    /// Combina configuración separada de proveedor y configuración global
    ///
    /// Si proveedor configuró meta.testConfig y enabled es true, usa configuración de proveedor para sobrescribir configuración global
    fn merge_provider_config(
        provider: &Provider,
        global_config: &StreamCheckConfig,
    ) -> StreamCheckConfig {
        let test_config = provider
            .meta
            .as_ref()
            .and_then(|m| m.test_config.as_ref())
            .filter(|tc| tc.enabled);

        match test_config {
            Some(tc) => StreamCheckConfig {
                timeout_secs: tc.timeout_secs.unwrap_or(global_config.timeout_secs),
                max_retries: tc.max_retries.unwrap_or(global_config.max_retries),
                degraded_threshold_ms: tc
                    .degraded_threshold_ms
                    .unwrap_or(global_config.degraded_threshold_ms),
                claude_model: tc
                    .test_model
                    .clone()
                    .unwrap_or_else(|| global_config.claude_model.clone()),
                codex_model: tc
                    .test_model
                    .clone()
                    .unwrap_or_else(|| global_config.codex_model.clone()),
                gemini_model: tc
                    .test_model
                    .clone()
                    .unwrap_or_else(|| global_config.gemini_model.clone()),
                test_prompt: tc
                    .test_prompt
                    .clone()
                    .unwrap_or_else(|| global_config.test_prompt.clone()),
            },
            None => global_config.clone(),
        }
    }

    /// Verificación en streaming única
    async fn check_once(
        app_type: &AppType,
        provider: &Provider,
        config: &StreamCheckConfig,
        auth_override: Option<AuthInfo>,
        base_url_override: Option<String>,
        claude_api_format_override: Option<String>,
    ) -> Result<StreamCheckResult, AppError> {
        let start = Instant::now();

        // Estructura settings_config de OpenCode / OpenClaw difiere de Claude/Codex/Gemini
        // (baseUrl / apiKey directamente como campos raíz en vez de anidados en env), y protocolo se especifica explícitamente por campo `api`
        // o `npm`. No siguen ruta get_adapter, sino que se despachan directamente.
        if matches!(
            app_type,
            AppType::OpenCode | AppType::OpenClaw | AppType::Hermes
        ) {
            return Self::check_once_without_adapter(app_type, provider, config, start).await;
        }

        let adapter: Box<dyn ProviderAdapter> = if matches!(app_type, AppType::ClaudeDesktop) {
            Box::new(ClaudeAdapter::new())
        } else {
            get_adapter(app_type)
        };

        let base_url = match base_url_override {
            Some(base_url) => base_url,
            None => adapter
                .extract_base_url(provider)
                .map_err(|e| AppError::Message(format!("Failed to extract base_url: {e}")))?,
        };

        let auth = auth_override
            .or_else(|| adapter.extract_auth(provider))
            .ok_or_else(|| AppError::Message("API Key not found".to_string()))?;

        // Obtiene cliente HTTP
        let client = crate::proxy::http_client::get();
        let request_timeout = std::time::Duration::from_secs(config.timeout_secs);

        let model_to_test = Self::resolve_test_model(app_type, provider, config);
        let test_prompt = &config.test_prompt;

        let result = match app_type {
            AppType::Claude | AppType::ClaudeDesktop => {
                Self::check_claude_stream(
                    &client,
                    &base_url,
                    &auth,
                    &model_to_test,
                    test_prompt,
                    request_timeout,
                    provider,
                    claude_api_format_override.as_deref(),
                    None,
                )
                .await
            }
            AppType::Codex => {
                Self::check_codex_stream(
                    &client,
                    &base_url,
                    &auth,
                    &model_to_test,
                    test_prompt,
                    request_timeout,
                    provider,
                )
                .await
            }
            AppType::Gemini => {
                Self::check_gemini_stream(
                    &client,
                    &base_url,
                    &auth,
                    &model_to_test,
                    test_prompt,
                    request_timeout,
                    None,
                )
                .await
            }
            AppType::OpenCode | AppType::OpenClaw | AppType::Hermes => {
                // Already handled via early dispatch above
                unreachable!("OpenCode/OpenClaw/Hermes ya procesados mediante check_once_without_adapter")
            }
        };

        let response_time = start.elapsed().as_millis() as u64;
        Ok(Self::build_stream_check_result(
            result,
            response_time,
            config.degraded_threshold_ms,
            &model_to_test,
        ))
    }

    /// Verificación en streaming Claude
    ///
    /// Selecciona formato de solicitud según api_format del proveedor:
    /// - "anthropic" (predeterminado): Anthropic Messages API (/v1/messages)
    /// - "openai_chat": OpenAI Chat Completions API (/v1/chat/completions)
    /// - "openai_responses": OpenAI Responses API (/v1/responses)
    /// - "gemini_native": Gemini Native streamGenerateContent
    ///
    /// `extra_headers` es una colección opcional de headers personalizados a nivel de proveedor (leídos desde OpenClaw
    /// `settings_config.headers` o `settings_config.options.headers` de OpenCode
    /// ), agregados después de todos los headers integrados, usados para sobrescribir o complementar (por ejemplo User-Agent personalizado).
    #[allow(clippy::too_many_arguments)]
    async fn check_claude_stream(
        client: &Client,
        base_url: &str,
        auth: &AuthInfo,
        model: &str,
        test_prompt: &str,
        timeout: std::time::Duration,
        provider: &Provider,
        claude_api_format_override: Option<&str>,
        extra_headers: Option<&serde_json::Map<String, serde_json::Value>>,
    ) -> Result<(u16, String), AppError> {
        let base = base_url.trim_end_matches('/');
        let is_github_copilot = auth.strategy == AuthStrategy::GitHubCopilot;

        // Detect api_format: meta.api_format > settings_config.api_format > default "anthropic"
        let api_format = provider
            .meta
            .as_ref()
            .and_then(|m| m.api_format.as_deref())
            .or_else(|| {
                provider
                    .settings_config
                    .get("api_format")
                    .and_then(|v| v.as_str())
            })
            .unwrap_or("anthropic");

        let effective_api_format = claude_api_format_override.unwrap_or(api_format);

        let is_full_url = provider
            .meta
            .as_ref()
            .and_then(|meta| meta.is_full_url)
            .unwrap_or(false);
        let is_openai_chat = effective_api_format == "openai_chat";
        let is_openai_responses = effective_api_format == "openai_responses";
        let is_gemini_native = effective_api_format == "gemini_native";
        let url = Self::resolve_claude_stream_url(
            base,
            auth.strategy,
            effective_api_format,
            is_full_url,
            model,
        );

        let max_tokens = if is_openai_responses { 16 } else { 1 };

        // Build from Anthropic-native shape first, then convert for configured targets.
        let anthropic_body = json!({
            "model": model,
            "max_tokens": max_tokens,
            "messages": [{ "role": "user", "content": test_prompt }],
            "stream": true
        });
        // Codex OAuth (proxy inverso ChatGPT Plus/Pro) necesita store:false + marca include,
        // Sino Stream Check será rechazado por servidor con 400 igual que ruta de producción.
        let is_codex_oauth = provider.is_codex_oauth();
        let codex_fast_mode = provider.codex_fast_mode_enabled();

        let body = if is_openai_responses {
            anthropic_to_responses(
                anthropic_body,
                Some(&provider.id),
                is_codex_oauth,
                codex_fast_mode,
            )
            .map_err(|e| AppError::Message(format!("Failed to build test request: {e}")))?
        } else if is_gemini_native {
            anthropic_to_gemini(anthropic_body)
                .map_err(|e| AppError::Message(format!("Failed to build test request: {e}")))?
        } else if is_openai_chat {
            anthropic_to_openai(anthropic_body)
                .map_err(|e| AppError::Message(format!("Failed to build test request: {e}")))?
        } else {
            anthropic_body
        };

        let mut request_builder = client.post(&url);

        if is_github_copilot {
            // Genera ID de rastreo de solicitud
            let request_id = uuid::Uuid::new_v4().to_string();
            request_builder = request_builder
                .header("authorization", format!("Bearer {}", auth.api_key))
                .header("content-type", "application/json")
                .header("accept", "text/event-stream")
                .header("accept-encoding", "identity")
                .header("user-agent", copilot_auth::COPILOT_USER_AGENT)
                .header("editor-version", copilot_auth::COPILOT_EDITOR_VERSION)
                .header(
                    "editor-plugin-version",
                    copilot_auth::COPILOT_PLUGIN_VERSION,
                )
                .header(
                    "copilot-integration-id",
                    copilot_auth::COPILOT_INTEGRATION_ID,
                )
                .header("x-github-api-version", copilot_auth::COPILOT_API_VERSION)
                // 260401 agrega headers clave de copilot
                .header("openai-intent", "conversation-agent")
                .header("x-initiator", "user")
                .header("x-interaction-type", "conversation-agent")
                .header("x-vscode-user-agent-library-version", "electron-fetch")
                .header("x-request-id", &request_id)
                .header("x-agent-task-id", &request_id);
        } else if is_gemini_native {
            request_builder = match auth.strategy {
                AuthStrategy::GoogleOAuth => {
                    let token = auth.access_token.as_ref().unwrap_or(&auth.api_key);
                    request_builder
                        .header("authorization", format!("Bearer {token}"))
                        .header("x-goog-api-client", "GeminiCLI/1.0")
                        .header("content-type", "application/json")
                        .header("accept", "text/event-stream")
                        .header("accept-encoding", "identity")
                }
                _ => request_builder
                    .header("x-goog-api-key", &auth.api_key)
                    .header("content-type", "application/json")
                    .header("accept", "text/event-stream")
                    .header("accept-encoding", "identity"),
            };
        } else if is_openai_chat || is_openai_responses {
            // OpenAI-compatible targets: Bearer auth + SSE headers only
            request_builder = request_builder
                .header("authorization", format!("Bearer {}", auth.api_key))
                .header("content-type", "application/json")
                .header("accept", "text/event-stream")
                .header("accept-encoding", "identity");
        } else {
            // Anthropic native: full Claude CLI headers
            let os_name = Self::get_os_name();
            let arch_name = Self::get_arch_name();

            // Header de autenticación reutiliza ClaudeAdapter::get_auth_headers, mantiene fuente única de verdad con ruta proxy (forwarder).
            // - AuthStrategy::Anthropic  → x-api-key
            // - AuthStrategy::ClaudeAuth → Authorization: Bearer
            // - AuthStrategy::Bearer     → Authorization: Bearer
            // Evita falsos negativos / conflicto auth causado por anterior "Bearer incondicional + x-api-key condicional doble envío".
            let auth_headers = ClaudeAdapter::new()
                .get_auth_headers(auth)
                .map_err(|e| AppError::Message(format!("stream check falló construir header de autenticación: {e}")))?;
            for (name, value) in auth_headers {
                request_builder = request_builder.header(name, value);
            }

            request_builder = request_builder
                // Anthropic required headers
                .header("anthropic-version", "2023-06-01")
                .header(
                    "anthropic-beta",
                    "claude-code-20250219,interleaved-thinking-2025-05-14",
                )
                .header("anthropic-dangerous-direct-browser-access", "true")
                // Content type headers
                .header("content-type", "application/json")
                .header("accept", "application/json")
                .header("accept-encoding", "identity")
                .header("accept-language", "*")
                // Client identification headers
                .header("user-agent", "claude-cli/2.1.2 (external, cli)")
                .header("x-app", "cli")
                // x-stainless SDK headers (dynamic local system info)
                .header("x-stainless-lang", "js")
                .header("x-stainless-package-version", "0.70.0")
                .header("x-stainless-os", os_name)
                .header("x-stainless-arch", arch_name)
                .header("x-stainless-runtime", "node")
                .header("x-stainless-runtime-version", "v22.20.0")
                .header("x-stainless-retry-count", "0")
                .header("x-stainless-timeout", "600")
                // Other headers
                .header("sec-fetch-mode", "cors");
        }

        // Headers personalizados de proveedor agregados al final, permite sobrescribir valores predeterminados integrados (por ejemplo user-agent)
        if let Some(headers) = extra_headers {
            for (key, value) in headers {
                if let Some(v) = value.as_str() {
                    request_builder = request_builder.header(key.as_str(), v);
                }
            }
        }

        let response = request_builder
            .timeout(timeout)
            .json(&body)
            .send()
            .await
            .map_err(Self::map_request_error)?;

        let status = response.status().as_u16();

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(Self::http_status_error(status, error_text));
        }

        // Lectura en streaming: solo necesita primer chunk
        let mut stream = response.bytes_stream();
        if let Some(chunk) = stream.next().await {
            match chunk {
                Ok(_) => Ok((status, model.to_string())),
                Err(e) => Err(AppError::Message(format!("Stream read failed: {e}"))),
            }
        } else {
            Err(AppError::Message("No response data received".to_string()))
        }
    }

    /// Verificación en streaming Codex
    ///
    /// Construye solicitud estrictamente según formato de solicitud real Codex CLI (Responses API)
    async fn check_codex_stream(
        client: &Client,
        base_url: &str,
        auth: &AuthInfo,
        model: &str,
        test_prompt: &str,
        timeout: std::time::Duration,
        provider: &Provider,
    ) -> Result<(u16, String), AppError> {
        let is_full_url = provider
            .meta
            .as_ref()
            .and_then(|meta| meta.is_full_url)
            .unwrap_or(false);
        let urls = Self::resolve_codex_stream_urls(base_url, is_full_url);

        // Parsea nombre de modelo y nivel de razonamiento (soporta formato model@level o model#level)
        let (actual_model, reasoning_effort) = Self::parse_model_with_effort(model);

        // Obtiene información del sistema local
        let os_name = Self::get_os_name();
        let arch_name = Self::get_arch_name();

        // Formato de cuerpo de solicitud Responses API (input debe ser array)
        let mut body = json!({
            "model": actual_model,
            "input": [{ "role": "user", "content": test_prompt }],
            "stream": true
        });

        // Si es modelo de razonamiento, agrega reasoning_effort
        if let Some(effort) = reasoning_effort {
            body["reasoning"] = json!({ "effort": effort });
        }

        for (i, url) in urls.iter().enumerate() {
            // Configura headers estrictamente según formato de solicitud Codex CLI
            let response = client
                .post(url)
                .header("authorization", format!("Bearer {}", auth.api_key))
                .header("content-type", "application/json")
                .header("accept", "text/event-stream")
                .header("accept-encoding", "identity")
                .header(
                    "user-agent",
                    format!("codex_cli_rs/0.80.0 ({os_name} 15.7.2; {arch_name}) Terminal"),
                )
                .header("originator", "codex_cli_rs")
                .timeout(timeout)
                .json(&body)
                .send()
                .await
                .map_err(Self::map_request_error)?;

            let status = response.status().as_u16();

            if !response.status().is_success() {
                let error_text = response.text().await.unwrap_or_default();
                // Estrategia de fallback: intenta siguiente solo cuando URL preferido devuelve 404
                if i == 0 && status == 404 && urls.len() > 1 {
                    continue;
                }
                return Err(Self::http_status_error(status, error_text));
            }

            let mut stream = response.bytes_stream();
            if let Some(chunk) = stream.next().await {
                match chunk {
                    Ok(_) => return Ok((status, actual_model)),
                    Err(e) => return Err(AppError::Message(format!("Stream read failed: {e}"))),
                }
            }

            return Err(AppError::Message("No response data received".to_string()));
        }

        Err(AppError::Message(
            "No valid Codex responses endpoint found".to_string(),
        ))
    }

    /// Verificación en streaming Gemini
    ///
    /// Usa formato API nativo Gemini (streamGenerateContent)
    async fn check_gemini_stream(
        client: &Client,
        base_url: &str,
        auth: &AuthInfo,
        model: &str,
        test_prompt: &str,
        timeout: std::time::Duration,
        extra_headers: Option<&serde_json::Map<String, serde_json::Value>>,
    ) -> Result<(u16, String), AppError> {
        let base = base_url.trim_end_matches('/');
        // Strip `models/` resource-name prefix from the model id — see
        // `normalize_gemini_model_id` for rationale.
        let normalized_model = normalize_gemini_model_id(model);
        // API nativo Gemini: /v1beta/models/{model}:streamGenerateContent?alt=sse
        // Manejo inteligente de ruta /v1beta: si base_url no contiene ruta de versión, agrega /v1beta
        // Parámetro alt=sse hace que API devuelva formato SSE (text/event-stream) en vez de array JSON
        let url = if base.contains("/v1beta") || base.contains("/v1/") {
            format!("{base}/models/{normalized_model}:streamGenerateContent?alt=sse")
        } else {
            format!("{base}/v1beta/models/{normalized_model}:streamGenerateContent?alt=sse")
        };

        // Formato de cuerpo de solicitud nativo Gemini
        let body = json!({
            "contents": [{
                "role": "user",
                "parts": [{ "text": test_prompt }]
            }]
        });

        let mut request_builder = client
            .post(&url)
            .header("x-goog-api-key", &auth.api_key)
            .header("Content-Type", "application/json")
            .header("Accept", "text/event-stream");

        // Headers personalizados de proveedor agregados al final
        if let Some(headers) = extra_headers {
            for (key, value) in headers {
                if let Some(v) = value.as_str() {
                    request_builder = request_builder.header(key.as_str(), v);
                }
            }
        }

        let response = request_builder
            .timeout(timeout)
            .json(&body)
            .send()
            .await
            .map_err(Self::map_request_error)?;

        let status = response.status().as_u16();

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(Self::http_status_error(status, error_text));
        }

        let mut stream = response.bytes_stream();
        if let Some(chunk) = stream.next().await {
            match chunk {
                Ok(_) => Ok((status, model.to_string())),
                Err(e) => Err(AppError::Message(format!("Stream read failed: {e}"))),
            }
        } else {
            Err(AppError::Message("No response data received".to_string()))
        }
    }

    /// Entrada de despacho independiente de OpenCode / OpenClaw (evita `get_adapter`)
    ///
    /// `settings_config` de estas dos aplicaciones completamente diferente de Claude/Codex/Gemini:
    /// - OpenClaw: `{ baseUrl, apiKey, api, models: [...] }`, el campo `api` indica el protocolo
    /// - OpenCode: `{ npm, options: { baseURL, apiKey }, models: {...} }`, campo `npm` identifica protocolo
    ///
    /// Por lo tanto no puede reutilizar `get_adapter` (hará fallback a CodexAdapter y extracción fallará),
    /// Cambiado a parseo independiente de base_url/api_key/protocolo, luego despacha a funciones check_*_stream existentes.
    async fn check_once_without_adapter(
        app_type: &AppType,
        provider: &Provider,
        config: &StreamCheckConfig,
        start: Instant,
    ) -> Result<StreamCheckResult, AppError> {
        // Obtiene cliente HTTP
        let client = crate::proxy::http_client::get();
        let request_timeout = std::time::Duration::from_secs(config.timeout_secs);

        let model_to_test = Self::resolve_test_model(app_type, provider, config);
        let test_prompt = &config.test_prompt;

        let result = match app_type {
            AppType::OpenClaw => {
                Self::check_additive_app_stream(
                    &client,
                    provider,
                    &model_to_test,
                    test_prompt,
                    request_timeout,
                )
                .await
            }
            AppType::OpenCode => {
                Self::check_opencode_stream(
                    &client,
                    provider,
                    &model_to_test,
                    test_prompt,
                    request_timeout,
                )
                .await
            }
            AppType::Hermes => {
                Self::check_hermes_stream(
                    &client,
                    provider,
                    &model_to_test,
                    test_prompt,
                    request_timeout,
                )
                .await
            }
            _ => unreachable!("check_once_without_adapter solo procesa OpenCode/OpenClaw/Hermes"),
        };

        let response_time = start.elapsed().as_millis() as u64;
        Ok(Self::build_stream_check_result(
            result,
            response_time,
            config.degraded_threshold_ms,
            &model_to_test,
        ))
    }

    /// Envuelve resultado crudo de check_*_stream en StreamCheckResult
    ///
    /// Extraído de lógica final de check_once, para que ramas independientes OpenCode/OpenClaw puedan reutilizar.
    ///
    /// `model_tested` es nombre de modelo usado en prueba actual, usado para transmitir información de modelo a frontend incluso en escenarios fallidos,
    /// facilita renderizar avisos especializados para errores como "modelo no existe / descontinuado".
    fn build_stream_check_result(
        result: Result<(u16, String), AppError>,
        response_time: u64,
        degraded_threshold_ms: u64,
        model_tested: &str,
    ) -> StreamCheckResult {
        let tested_at = chrono::Utc::now().timestamp();
        match result {
            Ok((status_code, model)) => StreamCheckResult {
                status: Self::determine_status(response_time, degraded_threshold_ms),
                success: true,
                message: "Check succeeded".to_string(),
                response_time_ms: Some(response_time),
                http_status: Some(status_code),
                model_used: model,
                tested_at,
                retry_count: 0,
                error_category: None,
            },
            Err(e) => {
                let (http_status, message, error_category) = match &e {
                    AppError::HttpStatus { status, body } => {
                        let category = Self::detect_error_category(*status, body);
                        (
                            Some(*status),
                            Self::classify_http_status(*status).to_string(),
                            category.map(|s| s.to_string()),
                        )
                    }
                    _ => (None, e.to_string(), None),
                };
                StreamCheckResult {
                    status: HealthStatus::Failed,
                    success: false,
                    message,
                    response_time_ms: Some(response_time),
                    http_status,
                    model_used: model_tested.to_string(),
                    tested_at,
                    retry_count: 0,
                    error_category,
                }
            }
        }
    }

    /// Identifica clasificación de error de grano fino basada en código de estado HTTP y cuerpo de respuesta.
    ///
    /// Actualmente solo identifica "modelo no existe / descontinuado": ese tipo de error de varios proveedores usualmente devuelve 4xx, body contendrá
    /// como `model_not_found` (OpenAI), `does not exist`, `invalid model`, `not_found_error`
    /// + palabras `model` (Anthropic) etc marcadores.
    pub(crate) fn detect_error_category(status: u16, body: &str) -> Option<&'static str> {
        // Solo verifica 4xx; mensaje de error 5xx puede coincidir con palabras como "model", fácil malinterpretar
        if !(400..500).contains(&status) {
            return None;
        }
        let lower = body.to_lowercase();
        let qianfan_quota_indicators = [
            "coding_plan_hour_quota_exceeded",
            "coding_plan_week_quota_exceeded",
            "coding_plan_month_quota_exceeded",
        ];
        if qianfan_quota_indicators.iter().any(|s| lower.contains(s)) {
            return Some("quotaExceeded");
        }

        // Debe mencionar "model", evita que 404 / 400 genérico sea malinterpretado
        if !lower.contains("model") {
            return None;
        }
        let indicators = [
            "model_not_found",
            "model not found",
            "does not exist",
            "invalid_model",
            "invalid model",
            "unknown_model",
            "unknown model",
            "is not a valid model",
            "not_found_error", // campo type de Anthropic
        ];
        if indicators.iter().any(|s| lower.contains(s)) {
            return Some("modelNotFound");
        }
        None
    }

    /// Despachador de verificación en streaming OpenClaw
    ///
    /// Despacha a verificador de protocolo correspondiente según campo `settings_config.api`.
    /// Ver valores en `openclawApiProtocols` (frontend openclawProviderPresets.ts):
    /// - `openai-completions`   → check_claude_stream + api_format="openai_chat"
    /// - `openai-responses`     → check_claude_stream + api_format="openai_responses"
    /// - `anthropic-messages`   → check_claude_stream + api_format="anthropic" (estrategia ClaudeAuth)
    /// - `google-generative-ai` → check_gemini_stream (estrategia Google API Key)
    /// - `bedrock-converse-stream` → no soportado (requiere firma AWS SigV4)
    async fn check_additive_app_stream(
        client: &Client,
        provider: &Provider,
        model: &str,
        test_prompt: &str,
        timeout: std::time::Duration,
    ) -> Result<(u16, String), AppError> {
        // Headers de autenticación personalizados (como header `apikey` de Longcat) no usan Bearer estándar,
        // nombre exacto del header lo decide internamente gateway OpenClaw, cc-switch no puede construir con precisión,
        // por lo tanto devuelve error amigable directamente en vez de dejar usuario ver 401 engañoso.
        if Self::additive_app_uses_auth_header(provider) {
            return Err(AppError::localized(
                "openclaw_auth_header_not_supported",
                "Este proveedor usa header de autenticación personalizado, actualmente no soporta verificación de salud en streaming. Se recomienda probar directamente mediante OpenClaw.",
                "This provider uses a custom auth header; stream health check is not supported. Please test it directly via OpenClaw.",
            ));
        }

        let base_url = Self::extract_openclaw_base_url(provider)?;
        let api_key = Self::extract_openclaw_api_key(provider)?;
        let api = Self::extract_openclaw_protocol(provider);
        let extra_headers = Self::extract_openclaw_headers(provider);

        match api.as_deref() {
            Some("openai-completions") => {
                let auth = AuthInfo::new(api_key, AuthStrategy::Bearer);
                Self::check_claude_stream(
                    client,
                    &base_url,
                    &auth,
                    model,
                    test_prompt,
                    timeout,
                    provider,
                    Some("openai_chat"),
                    extra_headers,
                )
                .await
            }
            Some("openai-responses") => {
                let auth = AuthInfo::new(api_key, AuthStrategy::Bearer);
                Self::check_claude_stream(
                    client,
                    &base_url,
                    &auth,
                    model,
                    test_prompt,
                    timeout,
                    provider,
                    Some("openai_responses"),
                    extra_headers,
                )
                .await
            }
            Some("anthropic-messages") => {
                // Usa ClaudeAuth (Bearer-only) para compatibilidad con servicio de relay Claude.
                // Algunos relays reportan error al recibir Authorization y x-api-key simultáneamente, estrategia ClaudeAuth
                // garantiza solo enviar Bearer. Anthropic oficial también acepta Bearer puro.
                let auth = AuthInfo::new(api_key, AuthStrategy::ClaudeAuth);
                Self::check_claude_stream(
                    client,
                    &base_url,
                    &auth,
                    model,
                    test_prompt,
                    timeout,
                    provider,
                    Some("anthropic"),
                    extra_headers,
                )
                .await
            }
            Some("google-generative-ai") => {
                let auth = AuthInfo::new(api_key, AuthStrategy::Google);
                Self::check_gemini_stream(
                    client,
                    &base_url,
                    &auth,
                    model,
                    test_prompt,
                    timeout,
                    extra_headers,
                )
                .await
            }
            Some("bedrock-converse-stream") => Err(AppError::localized(
                "openclaw_bedrock_not_supported",
                "AWS Bedrock requiere firma SigV4, actualmente no soporta verificación de salud. Verifique conectividad mediante consola AWS u OpenClaw.",
                "AWS Bedrock requires SigV4 signing and is not supported by stream health check. Please verify connectivity via AWS console or OpenClaw.",
            )),
            Some(other) => Err(AppError::localized(
                "openclaw_protocol_not_yet_supported",
                format!("OpenClaw actualmente no soporta protocolo: {other}"),
                format!("OpenClaw protocol not yet supported: {other}"),
            )),
            None => Err(AppError::localized(
                "openclaw_protocol_missing",
                "Proveedor OpenClaw carece de campo api",
                "OpenClaw provider is missing the `api` field",
            )),
        }
    }

    /// Determina si proveedor additive-mode usa header de autenticación personalizado (`authHeader: true`)
    fn additive_app_uses_auth_header(provider: &Provider) -> bool {
        provider
            .settings_config
            .get("authHeader")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
    }

    /// Extrae headers personalizados de proveedor OpenClaw (desde `settings_config.headers`)
    fn extract_openclaw_headers(
        provider: &Provider,
    ) -> Option<&serde_json::Map<String, serde_json::Value>> {
        provider
            .settings_config
            .get("headers")
            .and_then(|v| v.as_object())
            .filter(|m| !m.is_empty())
    }

    fn extract_openclaw_base_url(provider: &Provider) -> Result<String, AppError> {
        provider
            .settings_config
            .get("baseUrl")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                AppError::localized(
                    "openclaw_base_url_missing",
                    "Proveedor OpenClaw carece de baseUrl",
                    "OpenClaw provider is missing `baseUrl`",
                )
            })
    }

    fn extract_openclaw_api_key(provider: &Provider) -> Result<String, AppError> {
        provider
            .settings_config
            .get("apiKey")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                AppError::localized(
                    "openclaw_api_key_missing",
                    "Proveedor OpenClaw carece de apiKey",
                    "OpenClaw provider is missing `apiKey`",
                )
            })
    }

    fn extract_openclaw_protocol(provider: &Provider) -> Option<String> {
        provider
            .settings_config
            .get("api")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    }

    // settings_config de Hermes usa snake_case (base_url / api_key / api_mode),
    // con camelCase de OpenClaw (baseUrl / apiKey / api) son dos nomenclaturas independientes.
    // Ver HermesProviderSettingsConfig en src/config/hermesProviderPresets.ts.
    fn extract_hermes_base_url(provider: &Provider) -> Result<String, AppError> {
        provider
            .settings_config
            .get("base_url")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                AppError::localized(
                    "hermes_base_url_missing",
                    "Proveedor Hermes carece de base_url",
                    "Hermes provider is missing `base_url`",
                )
            })
    }

    fn extract_hermes_api_key(provider: &Provider) -> Result<String, AppError> {
        provider
            .settings_config
            .get("api_key")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                AppError::localized(
                    "hermes_api_key_missing",
                    "Proveedor Hermes carece de api_key",
                    "Hermes provider is missing `api_key`",
                )
            })
    }

    fn extract_hermes_api_mode(provider: &Provider) -> Option<String> {
        provider
            .settings_config
            .get("api_mode")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    }

    /// Despachador de verificación en streaming Hermes
    ///
    /// Hermes especifica explícitamente protocolo con campo `api_mode`, valores de
    /// `HermesApiMode`（hermesProviderPresets.ts）：
    /// - `chat_completions`   → check_claude_stream + api_format="openai_chat"（Bearer）
    /// - `anthropic_messages` → check_claude_stream + api_format="anthropic" (ClaudeAuth, misma estrategia que anthropic-messages de OpenClaw)
    /// - `codex_responses`    → check_claude_stream + api_format="openai_responses"（Bearer）
    /// - `bedrock_converse`   → no soportado (requiere firma AWS SigV4)
    async fn check_hermes_stream(
        client: &Client,
        provider: &Provider,
        model: &str,
        test_prompt: &str,
        timeout: std::time::Duration,
    ) -> Result<(u16, String), AppError> {
        // Primero enruta api_mode a formato de protocolo y estrategia de autenticación.
        // Ruta de solo error (bedrock / desconocido / faltante) devuelve directamente, evita cuando usuario
        // eligió bedrock_converse ser cubierto por error secundario "falta base_url" ocultando razón real.
        let (api_format, auth_strategy) = match Self::extract_hermes_api_mode(provider).as_deref() {
            Some("chat_completions") => ("openai_chat", AuthStrategy::Bearer),
            Some("anthropic_messages") => ("anthropic", AuthStrategy::ClaudeAuth),
            Some("codex_responses") => ("openai_responses", AuthStrategy::Bearer),
            Some("bedrock_converse") => {
                return Err(AppError::localized(
                    "hermes_bedrock_not_supported",
                    "AWS Bedrock requiere firma SigV4, actualmente no soporta verificación de salud.",
                    "AWS Bedrock requires SigV4 signing and is not supported by stream health check.",
                ));
            }
            Some(other) => {
                return Err(AppError::localized(
                    "hermes_protocol_not_yet_supported",
                    format!("Hermes actualmente no soporta protocolo: {other}"),
                    format!("Hermes protocol not yet supported: {other}"),
                ));
            }
            None => {
                return Err(AppError::localized(
                    "hermes_api_mode_missing",
                    "Proveedor Hermes carece de campo api_mode",
                    "Hermes provider is missing the `api_mode` field",
                ));
            }
        };

        let base_url = Self::extract_hermes_base_url(provider)?;
        let api_key = Self::extract_hermes_api_key(provider)?;
        let auth = AuthInfo::new(api_key, auth_strategy);
        Self::check_claude_stream(
            client,
            &base_url,
            &auth,
            model,
            test_prompt,
            timeout,
            provider,
            Some(api_format),
            None,
        )
        .await
    }

    /// Despachador de verificación en streaming OpenCode
    ///
    /// OpenCode especifica implícitamente protocolo con campo `npm` (nombre de paquete AI SDK). Ver relación de mapeo en
    /// `opencodeNpmPackages` (frontend opencodeProviderPresets.ts):
    /// - `@ai-sdk/openai-compatible` → check_claude_stream + api_format="openai_chat"
    /// - `@ai-sdk/openai`            → check_claude_stream + api_format="openai_responses"
    /// - `@ai-sdk/anthropic`         → check_claude_stream + api_format="anthropic"
    /// - `@ai-sdk/google`            → check_gemini_stream (estrategia Google API Key)
    /// - `@ai-sdk/amazon-bedrock`    → no soportado (requiere firma AWS SigV4)
    ///
    /// URL/API Key se almacenan en `settings_config.options.{baseURL,apiKey}`, nota
    /// `baseURL` L mayúscula (diferente de `baseUrl` de OpenClaw con u minúscula).
    async fn check_opencode_stream(
        client: &Client,
        provider: &Provider,
        model: &str,
        test_prompt: &str,
        timeout: std::time::Duration,
    ) -> Result<(u16, String), AppError> {
        let npm = Self::extract_opencode_npm(provider);
        // Si usuario no llenó explícitamente baseURL, hace fallback según npm a endpoint predeterminado del paquete AI SDK
        let base_url = Self::resolve_opencode_base_url(provider, npm.as_deref())?;
        let api_key = Self::extract_opencode_api_key(provider)?;
        let extra_headers = Self::extract_opencode_headers(provider);

        match npm.as_deref() {
            Some("@ai-sdk/openai-compatible") => {
                let auth = AuthInfo::new(api_key, AuthStrategy::Bearer);
                Self::check_claude_stream(
                    client,
                    &base_url,
                    &auth,
                    model,
                    test_prompt,
                    timeout,
                    provider,
                    Some("openai_chat"),
                    extra_headers,
                )
                .await
            }
            Some("@ai-sdk/openai") => {
                let auth = AuthInfo::new(api_key, AuthStrategy::Bearer);
                Self::check_claude_stream(
                    client,
                    &base_url,
                    &auth,
                    model,
                    test_prompt,
                    timeout,
                    provider,
                    Some("openai_responses"),
                    extra_headers,
                )
                .await
            }
            Some("@ai-sdk/anthropic") => {
                // Ver procesamiento de anthropic-messages en check_additive_app_stream:
                // Usa ClaudeAuth (Bearer-only) compatible con servicio de relay.
                let auth = AuthInfo::new(api_key, AuthStrategy::ClaudeAuth);
                Self::check_claude_stream(
                    client,
                    &base_url,
                    &auth,
                    model,
                    test_prompt,
                    timeout,
                    provider,
                    Some("anthropic"),
                    extra_headers,
                )
                .await
            }
            Some("@ai-sdk/google") => {
                let auth = AuthInfo::new(api_key, AuthStrategy::Google);
                Self::check_gemini_stream(
                    client,
                    &base_url,
                    &auth,
                    model,
                    test_prompt,
                    timeout,
                    extra_headers,
                )
                .await
            }
            Some("@ai-sdk/amazon-bedrock") => Err(AppError::localized(
                "opencode_bedrock_not_supported",
                "AWS Bedrock requiere firma SigV4, actualmente no soporta verificación de salud. Verifique conectividad mediante consola AWS u OpenCode.",
                "AWS Bedrock requires SigV4 signing and is not supported by stream health check. Please verify connectivity via AWS console or OpenCode.",
            )),
            Some(other) => Err(AppError::localized(
                "opencode_npm_not_yet_supported",
                format!("OpenCode actualmente no soporta paquete SDK: {other}"),
                format!("OpenCode SDK package not yet supported: {other}"),
            )),
            None => Err(AppError::localized(
                "opencode_npm_missing",
                "Proveedor OpenCode carece de campo npm",
                "OpenCode provider is missing the `npm` field",
            )),
        }
    }

    /// Determina baseURL según características reales de paquete SDK de OpenCode:
    /// - `options.baseURL` llenado explícitamente por usuario siempre tiene prioridad
    /// - Sino devuelve endpoint predeterminado del paquete AI SDK según `npm`
    /// - `@ai-sdk/openai-compatible` no tiene endpoint predeterminado, debe llenarse explícitamente
    ///
    /// Nota: endpoint predeterminado aquí corresponde al comportamiento del paquete AI SDK (por ejemplo `@ai-sdk/openai`
    /// viene con sufijo de ruta `/v1`), con `proxy/providers/mod.rs`
    /// semántica de `ProviderType::default_endpoint()` es diferente — este último es upstream de capa proxy
    /// valor predeterminado, sin `/v1`. Ambos mantienen valores predeterminados de sistemas diferentes, no pueden compartirse simplemente.
    fn resolve_opencode_base_url(
        provider: &Provider,
        npm: Option<&str>,
    ) -> Result<String, AppError> {
        if let Some(explicit) = Self::extract_opencode_base_url(provider) {
            return Ok(explicit);
        }

        let fallback = match npm {
            Some("@ai-sdk/openai") => Some("https://api.openai.com/v1"),
            Some("@ai-sdk/anthropic") => Some("https://api.anthropic.com"),
            Some("@ai-sdk/google") => Some("https://generativelanguage.googleapis.com"),
            _ => None,
        };

        fallback.map(|s| s.to_string()).ok_or_else(|| {
            AppError::localized(
                "opencode_base_url_missing",
                "Proveedor OpenCode carece de options.baseURL, y paquete SDK actual no tiene endpoint predeterminado",
                "OpenCode provider is missing `options.baseURL` and the SDK package has no default endpoint",
            )
        })
    }

    fn extract_opencode_base_url(provider: &Provider) -> Option<String> {
        provider
            .settings_config
            .get("options")
            .and_then(|v| v.get("baseURL"))
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    }

    /// Extrae headers personalizados de proveedor OpenCode (desde `settings_config.options.headers`)
    fn extract_opencode_headers(
        provider: &Provider,
    ) -> Option<&serde_json::Map<String, serde_json::Value>> {
        provider
            .settings_config
            .get("options")
            .and_then(|v| v.get("headers"))
            .and_then(|v| v.as_object())
            .filter(|m| !m.is_empty())
    }

    fn extract_opencode_api_key(provider: &Provider) -> Result<String, AppError> {
        provider
            .settings_config
            .get("options")
            .and_then(|v| v.get("apiKey"))
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                AppError::localized(
                    "opencode_api_key_missing",
                    "Proveedor OpenCode carece de options.apiKey",
                    "OpenCode provider is missing `options.apiKey`",
                )
            })
    }

    fn extract_opencode_npm(provider: &Provider) -> Option<String> {
        provider
            .settings_config
            .get("npm")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    }

    fn determine_status(latency_ms: u64, threshold: u64) -> HealthStatus {
        if latency_ms <= threshold {
            HealthStatus::Operational
        } else {
            HealthStatus::Degraded
        }
    }

    /// Parsea nombre de modelo y nivel de razonamiento (soporta formato model@level o model#level)
    /// Devuelve (nombre real de modelo, Option<nivel de razonamiento>)
    fn parse_model_with_effort(model: &str) -> (String, Option<String>) {
        if let Some(pos) = model.find('@').or_else(|| model.find('#')) {
            let actual_model = model[..pos].to_string();
            let effort = model[pos + 1..].to_string();
            if !effort.is_empty() {
                return (actual_model, Some(effort));
            }
        }
        (model.to_string(), None)
    }

    fn should_retry(msg: &str) -> bool {
        let lower = msg.to_lowercase();
        lower.contains("timeout") || lower.contains("abort") || lower.contains("timed out")
    }

    fn map_request_error(e: reqwest::Error) -> AppError {
        if e.is_timeout() {
            AppError::Message("Request timeout".to_string())
        } else if e.is_connect() {
            AppError::Message(format!("Connection failed: {e}"))
        } else {
            AppError::Message(e.to_string())
        }
    }

    /// Construye error de código de estado HTTP, trunca cuerpo de respuesta demasiado largo
    fn http_status_error(status: u16, body: String) -> AppError {
        let body = if body.len() > 200 {
            // Truncado seguro: encuentra límite de char más cercano dentro de 200 bytes
            let mut end = 200;
            while end > 0 && !body.is_char_boundary(end) {
                end -= 1;
            }
            format!("{}…", &body[..end])
        } else {
            body
        };
        AppError::HttpStatus { status, body }
    }

    /// Mapea código de estado HTTP a etiqueta de clasificación corta
    pub(crate) fn classify_http_status(status: u16) -> &'static str {
        match status {
            400 => "Bad request (400)",
            401 => "Auth rejected (401)",
            402 => "Payment required (402)",
            403 => "Access denied (403)",
            404 => "Not found (404)",
            429 => "Rate limited (429)",
            500 => "Internal server error (500)",
            502 => "Bad gateway (502)",
            503 => "Service unavailable (503)",
            504 => "Gateway timeout (504)",
            s if (500..600).contains(&s) => "Server error",
            _ => "HTTP error",
        }
    }

    fn resolve_test_model(
        app_type: &AppType,
        provider: &Provider,
        config: &StreamCheckConfig,
    ) -> String {
        match app_type {
            AppType::Claude | AppType::ClaudeDesktop => {
                Self::extract_env_model(provider, "ANTHROPIC_MODEL")
                    .unwrap_or_else(|| config.claude_model.clone())
            }
            AppType::Codex => {
                Self::extract_codex_model(provider).unwrap_or_else(|| config.codex_model.clone())
            }
            AppType::Gemini => Self::extract_env_model(provider, "GEMINI_MODEL")
                .unwrap_or_else(|| config.gemini_model.clone()),
            AppType::OpenCode => {
                // OpenCode uses models map in settings_config
                // Try to extract first model from the models object
                Self::extract_opencode_model(provider).unwrap_or_else(|| "gpt-4o".to_string())
            }
            AppType::OpenClaw | AppType::Hermes => {
                // OpenClaw/Hermes use models array in settings_config
                // Try to extract first model from the models array
                Self::extract_openclaw_model(provider).unwrap_or_else(|| "gpt-4o".to_string())
            }
        }
    }

    fn extract_opencode_model(provider: &Provider) -> Option<String> {
        let models = provider
            .settings_config
            .get("models")
            .and_then(|m| m.as_object())?;

        // Return the first model ID from the models map
        models.keys().next().map(|s| s.to_string())
    }

    fn extract_openclaw_model(provider: &Provider) -> Option<String> {
        // OpenClaw uses models array: [{ "id": "model-id", "name": "Model Name" }]
        let models = provider
            .settings_config
            .get("models")
            .and_then(|m| m.as_array())?;

        // Return the first model ID from the models array
        models
            .first()
            .and_then(|m| m.get("id"))
            .and_then(|id| id.as_str())
            .map(|s| s.to_string())
    }

    fn extract_env_model(provider: &Provider, key: &str) -> Option<String> {
        provider
            .settings_config
            .get("env")
            .and_then(|env| env.get(key))
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    }

    fn extract_codex_model(provider: &Provider) -> Option<String> {
        let config_text = provider
            .settings_config
            .get("config")
            .and_then(|value| value.as_str())?;
        if config_text.trim().is_empty() {
            return None;
        }

        let table = toml::from_str::<toml::Table>(config_text).ok()?;
        table
            .get("model")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|value| !value.is_empty())
    }

    /// Obtiene nombre de sistema operativo (mapeado a formato usado por Claude CLI)
    fn get_os_name() -> &'static str {
        match std::env::consts::OS {
            "macos" => "MacOS",
            "linux" => "Linux",
            "windows" => "Windows",
            other => other,
        }
    }

    /// Obtiene nombre de arquitectura CPU (mapeado a formato usado por Claude CLI)
    fn get_arch_name() -> &'static str {
        match std::env::consts::ARCH {
            "aarch64" => "arm64",
            "x86_64" => "x86_64",
            "x86" => "x86",
            other => other,
        }
    }

    fn resolve_claude_stream_url(
        base_url: &str,
        auth_strategy: AuthStrategy,
        api_format: &str,
        is_full_url: bool,
        model: &str,
    ) -> String {
        if api_format == "gemini_native" {
            // Strip an optional `models/` resource-name prefix so that model
            // identifiers copied from Gemini SDK outputs (e.g.
            // `models/gemini-2.5-pro`) don't produce a doubled
            // `/v1beta/models/models/...` URL.
            let normalized_model = normalize_gemini_model_id(model);
            let endpoint =
                format!("/v1beta/models/{normalized_model}:streamGenerateContent?alt=sse");
            return resolve_gemini_native_url(base_url, &endpoint, is_full_url);
        }

        if is_full_url {
            return base_url.to_string();
        }

        let base = base_url.trim_end_matches('/');
        let is_github_copilot = auth_strategy == AuthStrategy::GitHubCopilot;

        if is_github_copilot && api_format == "openai_responses" {
            format!("{base}/v1/responses")
        } else if is_github_copilot {
            format!("{base}/chat/completions")
        } else if api_format == "openai_responses" {
            if base.ends_with("/v1") {
                format!("{base}/responses")
            } else {
                format!("{base}/v1/responses")
            }
        } else if api_format == "openai_chat" {
            if base.ends_with("/v1") {
                format!("{base}/chat/completions")
            } else {
                format!("{base}/v1/chat/completions")
            }
        } else if base.ends_with("/v1") {
            format!("{base}/messages")
        } else {
            format!("{base}/v1/messages")
        }
    }

    fn resolve_codex_stream_urls(base_url: &str, is_full_url: bool) -> Vec<String> {
        if is_full_url {
            return vec![base_url.to_string()];
        }

        let base = base_url.trim_end_matches('/');

        if base.ends_with("/v1") {
            vec![format!("{base}/responses")]
        } else {
            vec![format!("{base}/responses"), format!("{base}/v1/responses")]
        }
    }

    pub(crate) fn resolve_effective_test_model(
        app_type: &AppType,
        provider: &Provider,
        config: &StreamCheckConfig,
    ) -> String {
        let effective_config = Self::merge_provider_config(provider, config);
        Self::resolve_test_model(app_type, provider, &effective_config)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_provider(settings_config: serde_json::Value) -> Provider {
        Provider::with_id(
            "test".to_string(),
            "Test".to_string(),
            settings_config,
            None,
        )
    }

    #[test]
    fn test_additive_app_uses_auth_header_true() {
        let p = make_provider(serde_json::json!({
            "baseUrl": "https://api.longcat.chat/v1",
            "apiKey": "k",
            "api": "openai-completions",
            "authHeader": true,
        }));
        assert!(StreamCheckService::additive_app_uses_auth_header(&p));
    }

    #[test]
    fn test_additive_app_uses_auth_header_default_false() {
        let p = make_provider(serde_json::json!({
            "baseUrl": "https://api.deepseek.com/v1",
            "apiKey": "k",
            "api": "openai-completions",
        }));
        assert!(!StreamCheckService::additive_app_uses_auth_header(&p));
    }

    #[test]
    fn test_resolve_opencode_base_url_explicit_wins() {
        let p = make_provider(serde_json::json!({
            "npm": "@ai-sdk/openai",
            "options": { "baseURL": "https://proxy.local/v1", "apiKey": "k" },
            "models": {},
        }));
        let resolved =
            StreamCheckService::resolve_opencode_base_url(&p, Some("@ai-sdk/openai")).unwrap();
        assert_eq!(resolved, "https://proxy.local/v1");
    }

    #[test]
    fn test_resolve_opencode_base_url_falls_back_for_known_npm() {
        let p = make_provider(serde_json::json!({
            "npm": "@ai-sdk/openai",
            "options": { "apiKey": "k" },
            "models": {},
        }));
        let resolved =
            StreamCheckService::resolve_opencode_base_url(&p, Some("@ai-sdk/openai")).unwrap();
        assert_eq!(resolved, "https://api.openai.com/v1");

        let p2 = make_provider(serde_json::json!({
            "npm": "@ai-sdk/anthropic",
            "options": { "apiKey": "k" },
            "models": {},
        }));
        let resolved2 =
            StreamCheckService::resolve_opencode_base_url(&p2, Some("@ai-sdk/anthropic")).unwrap();
        assert_eq!(resolved2, "https://api.anthropic.com");
    }

    #[test]
    fn test_resolve_opencode_base_url_errors_for_openai_compatible_without_url() {
        // @ai-sdk/openai-compatible no tiene endpoint predeterminado, debe llenarse explícitamente
        let p = make_provider(serde_json::json!({
            "npm": "@ai-sdk/openai-compatible",
            "options": { "apiKey": "k" },
            "models": {},
        }));
        let result =
            StreamCheckService::resolve_opencode_base_url(&p, Some("@ai-sdk/openai-compatible"));
        assert!(result.is_err());
    }

    #[test]
    fn test_extract_openclaw_headers_preserves_map() {
        let p = make_provider(serde_json::json!({
            "baseUrl": "https://example.com/v1",
            "apiKey": "k",
            "api": "openai-completions",
            "headers": { "User-Agent": "MyBot/1.0", "X-Trace": "abc" },
        }));
        let headers = StreamCheckService::extract_openclaw_headers(&p).unwrap();
        assert_eq!(
            headers.get("User-Agent").and_then(|v| v.as_str()),
            Some("MyBot/1.0")
        );
        assert_eq!(headers.get("X-Trace").and_then(|v| v.as_str()), Some("abc"));
    }

    #[test]
    fn test_extract_openclaw_headers_ignores_empty_map() {
        let p = make_provider(serde_json::json!({
            "baseUrl": "https://example.com/v1",
            "apiKey": "k",
            "api": "openai-completions",
            "headers": {},
        }));
        assert!(StreamCheckService::extract_openclaw_headers(&p).is_none());
    }

    #[test]
    fn test_extract_opencode_headers_from_options() {
        let p = make_provider(serde_json::json!({
            "npm": "@ai-sdk/openai-compatible",
            "options": {
                "baseURL": "https://example.com/v1",
                "apiKey": "k",
                "headers": { "X-Custom": "yes" },
            },
            "models": {},
        }));
        let headers = StreamCheckService::extract_opencode_headers(&p).unwrap();
        assert_eq!(
            headers.get("X-Custom").and_then(|v| v.as_str()),
            Some("yes")
        );
    }

    #[test]
    fn test_determine_status() {
        assert_eq!(
            StreamCheckService::determine_status(3000, 6000),
            HealthStatus::Operational
        );
        assert_eq!(
            StreamCheckService::determine_status(6000, 6000),
            HealthStatus::Operational
        );
        assert_eq!(
            StreamCheckService::determine_status(6001, 6000),
            HealthStatus::Degraded
        );
    }

    #[test]
    fn test_should_retry() {
        assert!(StreamCheckService::should_retry("Request timeout"));
        assert!(StreamCheckService::should_retry("request timed out"));
        assert!(StreamCheckService::should_retry("connection abort"));
        assert!(!StreamCheckService::should_retry("API Key invalid"));
    }

    #[test]
    fn test_default_config() {
        let config = StreamCheckConfig::default();
        assert_eq!(config.timeout_secs, 45);
        assert_eq!(config.max_retries, 2);
        assert_eq!(config.degraded_threshold_ms, 6000);
    }

    #[test]
    fn test_parse_model_with_effort() {
        // Con separador @
        let (model, effort) = StreamCheckService::parse_model_with_effort("gpt-5.1-codex@low");
        assert_eq!(model, "gpt-5.1-codex");
        assert_eq!(effort, Some("low".to_string()));

        // Con separador #
        let (model, effort) = StreamCheckService::parse_model_with_effort("o1-preview#high");
        assert_eq!(model, "o1-preview");
        assert_eq!(effort, Some("high".to_string()));

        // Sin separador
        let (model, effort) = StreamCheckService::parse_model_with_effort("gpt-4o-mini");
        assert_eq!(model, "gpt-4o-mini");
        assert_eq!(effort, None);
    }

    #[test]
    fn test_detect_model_not_found() {
        // Respuesta típica OpenAI: 404 + código de error model_not_found
        let openai_404 = r#"{"error":{"message":"The model `gpt-5.1-codex` does not exist or you do not have access to it","type":"invalid_request_error","param":null,"code":"model_not_found"}}"#;
        assert_eq!(
            StreamCheckService::detect_error_category(404, openai_404),
            Some("modelNotFound")
        );

        // Respuesta típica Anthropic: 404 + not_found_error + menciona model
        let anthropic_404 = r#"{"type":"error","error":{"type":"not_found_error","message":"model: claude-deprecated"}}"#;
        assert_eq!(
            StreamCheckService::detect_error_category(404, anthropic_404),
            Some("modelNotFound")
        );

        // 400 + invalid model también cuenta
        let bad_req = r#"{"error":{"message":"invalid model specified"}}"#;
        assert_eq!(
            StreamCheckService::detect_error_category(400, bad_req),
            Some("modelNotFound")
        );

        // 404 genérico (por ejemplo error Base URL), body sin palabras model → no debería malinterpretar
        let generic_404 = r#"{"error":"Not Found"}"#;
        assert_eq!(
            StreamCheckService::detect_error_category(404, generic_404),
            None
        );

        // 5xx incluso si body tiene "model does not exist" no se clasifica (evita malinterpretación)
        let server_error = r#"{"error":"model does not exist"}"#;
        assert_eq!(
            StreamCheckService::detect_error_category(500, server_error),
            None
        );

        // Error de autenticación 401 (body sin palabras model)
        let auth_err = r#"{"error":"Invalid API key"}"#;
        assert_eq!(
            StreamCheckService::detect_error_category(401, auth_err),
            None
        );
    }

    #[test]
    fn test_detect_qianfan_coding_plan_quota_errors() {
        let cases = [
            r#"{"error":{"code":"coding_plan_hour_quota_exceeded","message":"hour quota exceeded"}}"#,
            r#"{"error":{"code":"coding_plan_week_quota_exceeded","message":"week quota exceeded"}}"#,
            r#"{"error":{"code":"coding_plan_month_quota_exceeded","message":"month quota exceeded"}}"#,
        ];

        for body in cases {
            assert_eq!(
                StreamCheckService::detect_error_category(429, body),
                Some("quotaExceeded")
            );
        }
    }

    #[test]
    fn test_get_os_name() {
        let os_name = StreamCheckService::get_os_name();
        // Asegura devolver string no vacío
        assert!(!os_name.is_empty());
        // En macOS debería devolver "MacOS"
        #[cfg(target_os = "macos")]
        assert_eq!(os_name, "MacOS");
        // En Linux debería devolver "Linux"
        #[cfg(target_os = "linux")]
        assert_eq!(os_name, "Linux");
        // En Windows debería devolver "Windows"
        #[cfg(target_os = "windows")]
        assert_eq!(os_name, "Windows");
    }

    #[test]
    fn test_get_arch_name() {
        let arch_name = StreamCheckService::get_arch_name();
        // Asegura devolver string no vacío
        assert!(!arch_name.is_empty());
        // En ARM64 debería devolver "arm64"
        #[cfg(target_arch = "aarch64")]
        assert_eq!(arch_name, "arm64");
        // En x86_64 debería devolver "x86_64"
        #[cfg(target_arch = "x86_64")]
        assert_eq!(arch_name, "x86_64");
    }

    #[test]
    fn test_auth_strategy_imports() {
        // Verifica que enum AuthStrategy puede usarse normalmente
        let anthropic = AuthStrategy::Anthropic;
        let claude_auth = AuthStrategy::ClaudeAuth;
        let bearer = AuthStrategy::Bearer;

        // Verifica que estrategias diferentes no son iguales
        assert_ne!(anthropic, claude_auth);
        assert_ne!(anthropic, bearer);
        assert_ne!(claude_auth, bearer);

        // Verifica que misma estrategia es igual
        assert_eq!(anthropic, AuthStrategy::Anthropic);
        assert_eq!(claude_auth, AuthStrategy::ClaudeAuth);
        assert_eq!(bearer, AuthStrategy::Bearer);
    }

    #[test]
    fn test_resolve_claude_stream_url_for_full_url_mode() {
        let url = StreamCheckService::resolve_claude_stream_url(
            "https://relay.example/v1/chat/completions",
            AuthStrategy::Bearer,
            "openai_chat",
            true,
            "gpt-5.4",
        );

        assert_eq!(url, "https://relay.example/v1/chat/completions");
    }

    #[test]
    fn test_resolve_claude_stream_url_for_github_copilot() {
        let url = StreamCheckService::resolve_claude_stream_url(
            "https://api.githubcopilot.com",
            AuthStrategy::GitHubCopilot,
            "openai_chat",
            false,
            "gpt-5.4",
        );

        assert_eq!(url, "https://api.githubcopilot.com/chat/completions");
    }

    #[test]
    fn test_resolve_claude_stream_url_for_github_copilot_responses() {
        let url = StreamCheckService::resolve_claude_stream_url(
            "https://api.githubcopilot.com",
            AuthStrategy::GitHubCopilot,
            "openai_responses",
            false,
            "gpt-5.4",
        );

        assert_eq!(url, "https://api.githubcopilot.com/v1/responses");
    }

    #[test]
    fn test_resolve_claude_stream_url_for_openai_chat() {
        let url = StreamCheckService::resolve_claude_stream_url(
            "https://example.com/v1",
            AuthStrategy::Bearer,
            "openai_chat",
            false,
            "gpt-5.4",
        );

        assert_eq!(url, "https://example.com/v1/chat/completions");
    }

    #[test]
    fn test_resolve_claude_stream_url_for_openai_responses() {
        let url = StreamCheckService::resolve_claude_stream_url(
            "https://example.com/v1",
            AuthStrategy::Bearer,
            "openai_responses",
            false,
            "gpt-5.4",
        );

        assert_eq!(url, "https://example.com/v1/responses");
    }

    #[test]
    fn test_resolve_claude_stream_url_for_anthropic() {
        let url = StreamCheckService::resolve_claude_stream_url(
            "https://api.anthropic.com",
            AuthStrategy::Anthropic,
            "anthropic",
            false,
            "claude-sonnet-4-6",
        );

        assert_eq!(url, "https://api.anthropic.com/v1/messages");
    }

    #[test]
    fn test_resolve_claude_stream_url_for_gemini_native() {
        let url = StreamCheckService::resolve_claude_stream_url(
            "https://generativelanguage.googleapis.com",
            AuthStrategy::Google,
            "gemini_native",
            false,
            "gemini-2.5-flash",
        );

        assert_eq!(
            url,
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse"
        );
    }

    #[test]
    fn test_resolve_claude_stream_url_for_gemini_native_full_url_openai_compat_base() {
        let url = StreamCheckService::resolve_claude_stream_url(
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
            AuthStrategy::Google,
            "gemini_native",
            true,
            "gemini-2.5-flash",
        );

        assert_eq!(
            url,
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse"
        );
    }

    #[test]
    fn test_resolve_claude_stream_url_for_gemini_native_opaque_full_url() {
        let url = StreamCheckService::resolve_claude_stream_url(
            "https://relay.example/custom/generate-content",
            AuthStrategy::Google,
            "gemini_native",
            true,
            "gemini-2.5-flash",
        );

        assert_eq!(url, "https://relay.example/custom/generate-content?alt=sse");
    }

    #[test]
    fn test_resolve_claude_stream_url_for_gemini_native_cloudflare_vertex_full_url() {
        let url = StreamCheckService::resolve_claude_stream_url(
            "https://gateway.ai.cloudflare.com/v1/account/gateway/google-vertex-ai/v1/projects/project/locations/us-central1/publishers/google/models/gemini-3.1-pro-preview:streamGenerateContent",
            AuthStrategy::Google,
            "gemini_native",
            true,
            "gemini-2.5-flash",
        );

        assert_eq!(
            url,
            "https://gateway.ai.cloudflare.com/v1/account/gateway/google-vertex-ai/v1/projects/project/locations/us-central1/publishers/google/models/gemini-3.1-pro-preview:streamGenerateContent?alt=sse"
        );
    }

    /// Regression: Gemini SDK outputs commonly surface model ids as the
    /// resource-name form `models/gemini-2.5-pro`. Interpolating that raw
    /// value used to produce `/v1beta/models/models/gemini-2.5-pro:...`
    /// which the upstream rejects and the health check records as a
    /// false-negative for an otherwise valid provider.
    #[test]
    fn test_resolve_claude_stream_url_for_gemini_native_strips_models_prefix() {
        let url = StreamCheckService::resolve_claude_stream_url(
            "https://generativelanguage.googleapis.com",
            AuthStrategy::Google,
            "gemini_native",
            false,
            "models/gemini-2.5-pro",
        );

        assert_eq!(
            url,
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse"
        );
    }

    #[test]
    fn test_resolve_codex_stream_urls_for_full_url_mode() {
        let urls = StreamCheckService::resolve_codex_stream_urls(
            "https://relay.example/custom/responses",
            true,
        );

        assert_eq!(urls, vec!["https://relay.example/custom/responses"]);
    }

    #[test]
    fn test_resolve_codex_stream_urls_for_v1_base() {
        let urls =
            StreamCheckService::resolve_codex_stream_urls("https://api.openai.com/v1", false);

        assert_eq!(urls, vec!["https://api.openai.com/v1/responses"]);
    }

    #[test]
    fn test_resolve_codex_stream_urls_for_origin_base() {
        let urls = StreamCheckService::resolve_codex_stream_urls("https://api.openai.com", false);

        assert_eq!(
            urls,
            vec![
                "https://api.openai.com/responses",
                "https://api.openai.com/v1/responses",
            ]
        );
    }
}
