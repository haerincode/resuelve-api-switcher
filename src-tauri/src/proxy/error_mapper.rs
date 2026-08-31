//! errortipoa HTTP estado码demapeo
//!
//! / ProxyError mapeoa合适de HTTP estado码，usar/日志registrar

use super::ProxyError;

/// / ProxyError mapeoa HTTP estado码
///
/// mapeo规entonces：
/// - upstreamerror：直接使usarupstreamretornardeestado码
/// - timeout：504 Gateway Timeout
/// - conexiónfalló：502 Bad Gateway
/// - sindisponible Provider：503 Service Unavailable
/// - reintentar耗尽：503 Service Unavailable
/// - 其他error：500 Internal Server Error
pub fn map_proxy_error_to_status(error: &ProxyError) -> u16 {
    match error {
        // upstreamerror：使usar实际estado码
        ProxyError::UpstreamError { status, .. } => *status,

        // timeouterror：504 Gateway Timeout
        ProxyError::Timeout(_) => 504,

        // 转发falló/conexiónfalló：502 Bad Gateway
        ProxyError::ForwardFailed(_) => 502,

        // sindisponible Provider：503 Service Unavailable
        ProxyError::NoAvailableProvider => 503,

        // 所有proveedorya熔断：503 Service Unavailable
        ProxyError::AllProvidersCircuitOpen => 503,

        // noconfiguraciónproveedor：503 Service Unavailable
        ProxyError::NoProvidersConfigured => 503,

        // reintentar耗尽：503 Service Unavailable
        ProxyError::MaxRetriesExceeded => 503,

        // Provider 不健康：503 Service Unavailable
        ProxyError::ProviderUnhealthy(_) => 503,

        // 数据库error：500 Internal Server Error
        ProxyError::DatabaseError(_) => 500,

        // convertirerror：500 Internal Server Error
        ProxyError::TransformError(_) => 500,

        // 其他no知error：500 Internal Server Error
        _ => 500,
    }
}

/// / ProxyError convertirparausar户友好deerrormensaje
pub fn get_error_message(error: &ProxyError) -> String {
    match error {
        ProxyError::UpstreamError { status, body } => {
            if let Some(body) = body {
                format!("upstreamerror ({status}): {body}")
            } else {
                format!("upstreamerror ({status})")
            }
        }
        ProxyError::Timeout(msg) => format!("solicitudtimeout: {msg}"),
        ProxyError::ForwardFailed(msg) => format!("转发falló: {msg}"),
        ProxyError::NoAvailableProvider => "sindisponible Provider".to_string(),
        ProxyError::AllProvidersCircuitOpen => "所有proveedorya熔断，sindisponible渠道".to_string(),
        ProxyError::NoProvidersConfigured => "noconfiguraciónproveedor".to_string(),
        ProxyError::MaxRetriesExceeded => "所有 Provider 都falló，reintentar耗尽".to_string(),
        ProxyError::ProviderUnhealthy(msg) => format!("Provider 不健康: {msg}"),
        ProxyError::DatabaseError(msg) => format!("数据库error: {msg}"),
        ProxyError::TransformError(msg) => format!("solicitud/respuestaconvertirerror: {msg}"),
        _ => error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_map_upstream_error() {
        let error = ProxyError::UpstreamError {
            status: 401,
            body: Some("Unauthorized".to_string()),
        };
        assert_eq!(map_proxy_error_to_status(&error), 401);
    }

    #[test]
    fn test_map_timeout_error() {
        let error = ProxyError::Timeout("Request timeout".to_string());
        assert_eq!(map_proxy_error_to_status(&error), 504);
    }

    #[test]
    fn test_map_connection_error() {
        let error = ProxyError::ForwardFailed("Connection refused".to_string());
        assert_eq!(map_proxy_error_to_status(&error), 502);
    }

    #[test]
    fn test_map_no_provider_error() {
        let error = ProxyError::NoAvailableProvider;
        assert_eq!(map_proxy_error_to_status(&error), 503);
    }

    #[test]
    fn test_get_error_message() {
        let error = ProxyError::UpstreamError {
            status: 500,
            body: Some("Internal Server Error".to_string()),
        };
        let msg = get_error_message(&error);
        assert!(msg.contains("upstreamerror"));
        assert!(msg.contains("500"));
        assert!(msg.contains("Internal Server Error"));
    }
}
