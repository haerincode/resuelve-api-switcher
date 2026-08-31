use rquickjs::{Context, Function, Runtime};
use serde_json::Value;
use std::collections::HashMap;
use url::{Host, Url};

use crate::error::AppError;

/// Ejecutar script de consulta de uso
pub async fn execute_usage_script(
    script_code: &str,
    api_key: &str,
    base_url: &str,
    timeout_secs: u64,
    access_token: Option<&str>,
    user_id: Option<&str>,
    template_type: Option<&str>,
) -> Result<Value, AppError> {
    // Detectar si es modo de plantilla personalizada
    // Priorizar el template_type pasado desde el frontend
    let is_custom_template = template_type.map(|t| t == "custom").unwrap_or(false);

    // 1. Reemplazar variables de plantilla, evitar filtración de información sensible
    let script_with_vars =
        build_script_with_vars(script_code, api_key, base_url, access_token, user_id);

    // 2. Validar seguridad de base_url (solo cuando se proporciona base_url)
    // En modo de plantilla personalizada, el usuario puede no usar variables de plantilla, sino escribir URL completa directamente en el script
    if !base_url.is_empty() {
        validate_base_url(base_url)?;
    }

    // 3. Extraer configuración de request en un ámbito independiente (asegurar que Runtime/Context se liberen antes de await)
    let request_config = {
        let runtime = Runtime::new().map_err(|e| {
            AppError::localized(
                "usage_script.runtime_create_failed",
                format!("Error al crear runtime de JS: {e}"),
                format!("Failed to create JS runtime: {e}"),
            )
        })?;
        let context = Context::full(&runtime).map_err(|e| {
            AppError::localized(
                "usage_script.context_create_failed",
                format!("Error al crear contexto de JS: {e}"),
                format!("Failed to create JS context: {e}"),
            )
        })?;

        context.with(|ctx| {
            // Ejecutar código del usuario, obtener objeto de configuración
            let config: rquickjs::Object = ctx.eval(script_with_vars.clone()).map_err(|e| {
                AppError::localized(
                    "usage_script.config_parse_failed",
                    format!("Error al analizar configuración: {e}"),
                    format!("Failed to parse config: {e}"),
                )
            })?;

            // Extraer configuración de request
            let request: rquickjs::Object = config.get("request").map_err(|e| {
                AppError::localized(
                    "usage_script.request_missing",
                    format!("Falta configuración de request: {e}"),
                    format!("Missing request config: {e}"),
                )
            })?;

            // Convertir request a cadena JSON
            let request_json: String = ctx
                .json_stringify(request)
                .map_err(|e| {
                    AppError::localized(
                        "usage_script.request_serialize_failed",
                        format!("Error al serializar request: {e}"),
                        format!("Failed to serialize request: {e}"),
                    )
                })?
                .ok_or_else(|| {
                    AppError::localized(
                        "usage_script.serialize_none",
                        "La serialización devolvió None",
                        "Serialization returned None",
                    )
                })?
                .get()
                .map_err(|e| {
                    AppError::localized(
                        "usage_script.get_string_failed",
                        format!("Error al obtener cadena: {e}"),
                        format!("Failed to get string: {e}"),
                    )
                })?;

            Ok::<_, AppError>(request_json)
        })?
    }; // Runtime y Context se eliminan aquí

    // 4. Analizar configuración de request
    let request: RequestConfig = serde_json::from_str(&request_config).map_err(|e| {
        AppError::localized(
            "usage_script.request_format_invalid",
            format!("Formato de configuración de request incorrecto: {e}"),
            format!("Invalid request config format: {e}"),
        )
    })?;

    // 5. Validar URL de solicitud (HTTPS forzado + verificación de mismo origen)
    validate_request_url(&request.url, base_url, is_custom_template)?;

    // 6. Enviar solicitud HTTP
    let response_data = send_http_request(&request, timeout_secs).await?;

    // 7. Ejecutar extractor en un ámbito independiente (asegurar que Runtime/Context se liberen antes del final de la función)
    let result: Value = {
        let runtime = Runtime::new().map_err(|e| {
            AppError::localized(
                "usage_script.runtime_create_failed",
                format!("Error al crear runtime de JS: {e}"),
                format!("Failed to create JS runtime: {e}"),
            )
        })?;
        let context = Context::full(&runtime).map_err(|e| {
            AppError::localized(
                "usage_script.context_create_failed",
                format!("Error al crear contexto de JS: {e}"),
                format!("Failed to create JS context: {e}"),
            )
        })?;

        context.with(|ctx| {
            // Re-evaluar para obtener objeto de configuración
            let config: rquickjs::Object = ctx.eval(script_with_vars.clone()).map_err(|e| {
                AppError::localized(
                    "usage_script.config_reparse_failed",
                    format!("Error al volver a analizar configuración: {e}"),
                    format!("Failed to re-parse config: {e}"),
                )
            })?;

            // Extraer función extractor
            let extractor: Function = config.get("extractor").map_err(|e| {
                AppError::localized(
                    "usage_script.extractor_missing",
                    format!("Falta función extractor: {e}"),
                    format!("Missing extractor function: {e}"),
                )
            })?;

            // Convertir datos de respuesta a valor JS
            let response_js: rquickjs::Value =
                ctx.json_parse(response_data.as_str()).map_err(|e| {
                    AppError::localized(
                        "usage_script.response_parse_failed",
                        format!("Error al analizar JSON de respuesta: {e}"),
                        format!("Failed to parse response JSON: {e}"),
                    )
                })?;

            // Llamar extractor(response)
            let result_js: rquickjs::Value = extractor.call((response_js,)).map_err(|e| {
                AppError::localized(
                    "usage_script.extractor_exec_failed",
                    format!("Error al ejecutar extractor: {e}"),
                    format!("Failed to execute extractor: {e}"),
                )
            })?;

            // Convertir a cadena JSON
            let result_json: String = ctx
                .json_stringify(result_js)
                .map_err(|e| {
                    AppError::localized(
                        "usage_script.result_serialize_failed",
                        format!("Error al serializar resultado: {e}"),
                        format!("Failed to serialize result: {e}"),
                    )
                })?
                .ok_or_else(|| {
                    AppError::localized(
                        "usage_script.serialize_none",
                        "La serialización devolvió None",
                        "Serialization returned None",
                    )
                })?
                .get()
                .map_err(|e| {
                    AppError::localized(
                        "usage_script.get_string_failed",
                        format!("Error al obtener cadena: {e}"),
                        format!("Failed to get string: {e}"),
                    )
                })?;

            // Analizar como serde_json::Value
            serde_json::from_str(&result_json).map_err(|e| {
                AppError::localized(
                    "usage_script.json_parse_failed",
                    format!("Error al analizar JSON: {e}"),
                    format!("JSON parse failed: {e}"),
                )
            })
        })?
    }; // Runtime y Context se eliminan aquí

    // 8. Validar formato del valor devuelto
    validate_result(&result)?;

    Ok(result)
}

/// Estructura de configuración de solicitud
#[derive(Debug, serde::Deserialize)]
struct RequestConfig {
    url: String,
    method: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    #[serde(default)]
    body: Option<String>,
}

/// Enviar solicitud HTTP
async fn send_http_request(config: &RequestConfig, timeout_secs: u64) -> Result<String, AppError> {
    // Usar el cliente HTTP global (ya incluye configuración de proxy)
    let client = crate::proxy::http_client::get();
    // Restringir rango de timeout, prevenir bloqueo prolongado por configuración anómala (mínimo 2 segundos, máximo 30 segundos)
    let request_timeout = std::time::Duration::from_secs(timeout_secs.clamp(2, 30));

    // Validación estricta del método HTTP, valores no válidos no se convierten a GET
    let method: reqwest::Method = config.method.parse().map_err(|_| {
        AppError::localized(
            "usage_script.invalid_http_method",
            format!("Método HTTP no soportado: {}", config.method),
            format!("Unsupported HTTP method: {}", config.method),
        )
    })?;

    let mut req = client
        .request(method.clone(), &config.url)
        .timeout(request_timeout);

    // Agregar encabezados de solicitud
    for (k, v) in &config.headers {
        req = req.header(k, v);
    }

    // Agregar cuerpo de solicitud
    if let Some(body) = &config.body {
        req = req.body(body.clone());
    }

    // Enviar solicitud
    let resp = req.send().await.map_err(|e| {
        AppError::localized(
            "usage_script.request_failed",
            format!("Solicitud fallida: {e}"),
            format!("Request failed: {e}"),
        )
    })?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| {
        AppError::localized(
            "usage_script.read_response_failed",
            format!("Error al leer respuesta: {e}"),
            format!("Failed to read response: {e}"),
        )
    })?;

    if !status.is_success() {
        let preview = if text.len() > 200 {
            let mut safe_cut = 200usize;
            while !text.is_char_boundary(safe_cut) {
                safe_cut = safe_cut.saturating_sub(1);
            }
            format!("{}...", &text[..safe_cut])
        } else {
            text.clone()
        };
        return Err(AppError::localized(
            "usage_script.http_error",
            format!("HTTP {status} : {preview}"),
            format!("HTTP {status} : {preview}"),
        ));
    }

    Ok(text)
}

/// Validar valor devuelto por el script (soporta objeto único o array)
fn validate_result(result: &Value) -> Result<(), AppError> {
    // Si es un array, validar cada elemento
    if let Some(arr) = result.as_array() {
        if arr.is_empty() {
            return Err(AppError::localized(
                "usage_script.empty_array",
                "El array devuelto por el script no puede estar vacío",
                "Script returned empty array",
            ));
        }
        for (idx, item) in arr.iter().enumerate() {
            validate_single_usage(item).map_err(|e| {
                AppError::localized(
                    "usage_script.array_validation_failed",
                    format!("Error de validación en índice del array [{idx}]: {e}"),
                    format!("Validation failed at index [{idx}]: {e}"),
                )
            })?;
        }
        return Ok(());
    }

    // Si es un objeto único, validar directamente (retrocompatibilidad)
    validate_single_usage(result)
}

/// Validar un objeto de datos de uso individual
fn validate_single_usage(result: &Value) -> Result<(), AppError> {
    let obj = result.as_object().ok_or_else(|| {
        AppError::localized(
            "usage_script.must_return_object",
            "El script debe devolver un objeto o array de objetos",
            "Script must return object or array of objects",
        )
    })?;

    // Todos los campos son opcionales, solo verificar tipo
    if obj.contains_key("isValid")
        && !result["isValid"].is_null()
        && !result["isValid"].is_boolean()
    {
        return Err(AppError::localized(
            "usage_script.isvalid_type_error",
            "isValid debe ser booleano o null",
            "isValid must be boolean or null",
        ));
    }
    if obj.contains_key("invalidMessage")
        && !result["invalidMessage"].is_null()
        && !result["invalidMessage"].is_string()
    {
        return Err(AppError::localized(
            "usage_script.invalidmessage_type_error",
            "invalidMessage debe ser cadena o null",
            "invalidMessage must be string or null",
        ));
    }
    if obj.contains_key("remaining")
        && !result["remaining"].is_null()
        && !result["remaining"].is_number()
    {
        return Err(AppError::localized(
            "usage_script.remaining_type_error",
            "remaining debe ser número o null",
            "remaining must be number or null",
        ));
    }
    if obj.contains_key("unit") && !result["unit"].is_null() && !result["unit"].is_string() {
        return Err(AppError::localized(
            "usage_script.unit_type_error",
            "unit debe ser cadena o null",
            "unit must be string or null",
        ));
    }
    if obj.contains_key("total") && !result["total"].is_null() && !result["total"].is_number() {
        return Err(AppError::localized(
            "usage_script.total_type_error",
            "total debe ser número o null",
            "total must be number or null",
        ));
    }
    if obj.contains_key("used") && !result["used"].is_null() && !result["used"].is_number() {
        return Err(AppError::localized(
            "usage_script.used_type_error",
            "used debe ser número o null",
            "used must be number or null",
        ));
    }
    if obj.contains_key("planName")
        && !result["planName"].is_null()
        && !result["planName"].is_string()
    {
        return Err(AppError::localized(
            "usage_script.planname_type_error",
            "planName debe ser cadena o null",
            "planName must be string or null",
        ));
    }
    if obj.contains_key("extra") && !result["extra"].is_null() && !result["extra"].is_string() {
        return Err(AppError::localized(
            "usage_script.extra_type_error",
            "extra debe ser cadena o null",
            "extra must be string or null",
        ));
    }

    Ok(())
}

/// Construir script con variables reemplazadas, mantener compatibilidad con scripts antiguos
fn build_script_with_vars(
    script_code: &str,
    api_key: &str,
    base_url: &str,
    access_token: Option<&str>,
    user_id: Option<&str>,
) -> String {
    let mut replaced = script_code
        .replace("{{apiKey}}", api_key)
        .replace("{{baseUrl}}", base_url);

    if let Some(token) = access_token {
        replaced = replaced.replace("{{accessToken}}", token);
    }
    if let Some(uid) = user_id {
        replaced = replaced.replace("{{userId}}", uid);
    }

    replaced
}

/// Validar seguridad básica de base_url
fn validate_base_url(base_url: &str) -> Result<(), AppError> {
    if base_url.is_empty() {
        return Err(AppError::localized(
            "usage_script.base_url_empty",
            "base_url no puede estar vacío",
            "base_url cannot be empty",
        ));
    }

    // Analizar URL
    let parsed_url = Url::parse(base_url).map_err(|e| {
        AppError::localized(
            "usage_script.base_url_invalid",
            format!("base_url no válido: {e}"),
            format!("Invalid base_url: {e}"),
        )
    })?;

    let is_loopback = is_loopback_host(&parsed_url);

    // Debe ser HTTPS (permitir localhost para desarrollo)
    if parsed_url.scheme() != "https" && !is_loopback {
        return Err(AppError::localized(
            "usage_script.base_url_https_required",
            "base_url debe usar protocolo HTTPS (excepto localhost)",
            "base_url must use HTTPS (localhost allowed)",
        ));
    }

    // Verificar validez de formato del nombre de host
    let hostname = parsed_url.host_str().ok_or_else(|| {
        AppError::localized(
            "usage_script.base_url_hostname_missing",
            "base_url debe incluir un nombre de host válido",
            "base_url must include a valid hostname",
        )
    })?;

    // Verificación básica de formato del nombre de host
    if hostname.is_empty() {
        return Err(AppError::localized(
            "usage_script.base_url_hostname_empty",
            "El nombre de host de base_url no puede estar vacío",
            "base_url hostname cannot be empty",
        ));
    }

    Ok(())
}

/// Validar si la URL de solicitud es segura (HTTPS forzado + verificación de mismo origen)
fn validate_request_url(
    request_url: &str,
    base_url: &str,
    is_custom_template: bool,
) -> Result<(), AppError> {
    // Analizar URL de solicitud
    let parsed_request = Url::parse(request_url).map_err(|e| {
        AppError::localized(
            "usage_script.request_url_invalid",
            format!("URL de solicitud no válida: {e}"),
            format!("Invalid request URL: {e}"),
        )
    })?;

    let is_request_loopback = is_loopback_host(&parsed_request);

    // Debe usar HTTPS (permitir localhost para desarrollo)
    // En modo de plantilla personalizada, permitir que el usuario decida si usar HTTP (el usuario debe asumir el riesgo de seguridad)
    if !is_custom_template && parsed_request.scheme() != "https" && !is_request_loopback {
        return Err(AppError::localized(
            "usage_script.request_https_required",
            "La URL de solicitud debe usar protocolo HTTPS (excepto localhost)",
            "Request URL must use HTTPS (localhost allowed)",
        ));
    }

    // Si se proporciona base_url (no vacío), realizar verificación de mismo origen
    // 🔧 En modo de plantilla personalizada, el usuario puede acceder libremente a cualquier dominio HTTPS, omitir verificación de mismo origen
    if !base_url.is_empty() && !is_custom_template {
        // Analizar base URL
        let parsed_base = Url::parse(base_url).map_err(|e| {
            AppError::localized(
                "usage_script.base_url_invalid",
                format!("base_url no válido: {e}"),
                format!("Invalid base_url: {e}"),
            )
        })?;

        // Verificación de seguridad central: debe ser del mismo origen que base_url (mismo dominio y puerto)
        if parsed_request.host_str() != parsed_base.host_str() {
            return Err(AppError::localized(
                "usage_script.request_host_mismatch",
                format!(
                    "El dominio de solicitud {} no coincide con el dominio de base_url {} (debe ser solicitud de mismo origen)",
                    parsed_request.host_str().unwrap_or("unknown"),
                    parsed_base.host_str().unwrap_or("unknown")
                ),
                format!(
                    "Request host {} must match base_url host {} (same-origin required)",
                    parsed_request.host_str().unwrap_or("unknown"),
                    parsed_base.host_str().unwrap_or("unknown")
                ),
            ));
        }

        // Verificar si los puertos coinciden (considerar puerto predeterminado)
        // Usar port_or_known_default() maneja automáticamente puertos predeterminados (http->80, https->443)
        match (
            parsed_request.port_or_known_default(),
            parsed_base.port_or_known_default(),
        ) {
            (Some(request_port), Some(base_port)) if request_port == base_port => {
                // Puerto coincide, continuar
            }
            (Some(request_port), Some(base_port)) => {
                return Err(AppError::localized(
                    "usage_script.request_port_mismatch",
                    format!("El puerto de solicitud {request_port} debe coincidir con el puerto de base_url {base_port}"),
                    format!("Request port {request_port} must match base_url port {base_port}"),
                ));
            }
            _ => {
                // Teóricamente no debería ocurrir, ya que port_or_known_default() siempre debería devolver Some
                return Err(AppError::localized(
                    "usage_script.request_port_unknown",
                    "No se puede determinar el número de puerto",
                    "Unable to determine port number",
                ));
            }
        }
    }

    Ok(())
}

/// Determinar si la URL apunta a la máquina local (localhost / loopback)
fn is_loopback_host(url: &Url) -> bool {
    match url.host() {
        Some(Host::Domain(d)) => d.eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(ip)) => ip.is_loopback(),
        Some(Host::Ipv6(ip)) => ip.is_loopback(),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_https_bypass_prevention() {
        // 非本地域名的 HTTP 应该被拒绝
        let result = validate_base_url("http://127.0.0.1.evil.com/api");
        assert!(
            result.is_err(),
            "Should reject HTTP for non-localhost domains"
        );
    }

    #[test]
    fn test_port_comparison() {
        // 测试端口比较逻辑是否正确处理默认端口和显式端口

        // 测试用例：(base_url, request_url, should_match)
        let test_cases = vec![
            // HTTPS默认端口测试
            (
                "https://api.example.com",
                "https://api.example.com/v1/test",
                true,
            ),
            (
                "https://api.example.com",
                "https://api.example.com:443/v1/test",
                true,
            ),
            (
                "https://api.example.com:443",
                "https://api.example.com/v1/test",
                true,
            ),
            (
                "https://api.example.com:443",
                "https://api.example.com:443/v1/test",
                true,
            ),
            // 端口不匹配测试
            (
                "https://api.example.com",
                "https://api.example.com:8443/v1/test",
                false,
            ),
            (
                "https://api.example.com:443",
                "https://api.example.com:8443/v1/test",
                false,
            ),
        ];

        for (base_url, request_url, should_match) in test_cases {
            let result = validate_request_url(request_url, base_url, false);

            if should_match {
                assert!(
                    result.is_ok(),
                    "URL que debería coincidir fue rechazada: base_url={}, request_url={}, error={}",
                    base_url,
                    request_url,
                    result.unwrap_err()
                );
            } else {
                assert!(
                    result.is_err(),
                    "URL que no debería coincidir fue permitida: base_url={}, request_url={}",
                    base_url,
                    request_url
                );
            }
        }
    }
}
