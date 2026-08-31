//! Response Handler - 统一respuestaprocesar
//!
//! 提供streamingy非streamingrespuestade统一procesar接口

use super::session::ProxySession;
use super::usage::parser::TokenUsage;
use super::ProxyError;
use crate::proxy::sse::{strip_sse_field, take_sse_block};
use bytes::Bytes;
use futures::stream::{Stream, StreamExt};
use serde_json::Value;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use tokio::time::timeout;

/// respuestatipo
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum ResponseType {
    /// streamingrespuesta (SSE)
    Stream,
    /// 非streamingrespuesta
    NonStream,
}

impl ResponseType {
    /// desde Content-Type 检测respuestatipo
    #[allow(dead_code)]
    pub fn from_content_type(content_type: &str) -> Self {
        if content_type.contains("text/event-stream") {
            ResponseType::Stream
        } else {
            ResponseType::NonStream
        }
    }
}

/// streamingrespuestaprocesar器
#[allow(dead_code)]
pub struct StreamHandler {
    /// 空闲timeout/间
    idle_timeout: Duration,
    /// 收集de事件
    events: Arc<Mutex<Vec<Value>>>,
}

#[allow(dead_code)]
impl StreamHandler {
    /// crear新destreamingprocesar器
    pub fn new(idle_timeout_secs: u64) -> Self {
        Self {
            idle_timeout: Duration::from_secs(idle_timeout_secs),
            events: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// procesarstreamingrespuesta，retornar分流后decliente流
    ///
    /// cliente流立即retornar，内部流en后台收集事件
    pub fn handle_stream<S>(
        &self,
        stream: S,
    ) -> impl Stream<Item = Result<Bytes, std::io::Error>> + Send
    where
        S: Stream<Item = Result<Bytes, reqwest::Error>> + Send + 'static,
    {
        let events = self.events.clone();
        let idle_timeout = self.idle_timeout;

        async_stream::stream! {
            let mut _last_activity = Instant::now();
            let mut buffer = String::new();
            let mut utf8_remainder: Vec<u8> = Vec::new();

            tokio::pin!(stream);

            loop {
                let chunk_result = timeout(idle_timeout, stream.next()).await;

                match chunk_result {
                    Ok(Some(Ok(bytes))) => {
                        _last_activity = Instant::now();

                        // analizar SSE 事件
                        crate::proxy::sse::append_utf8_safe(&mut buffer, &mut utf8_remainder, &bytes);

                        // 提取完整事件
                        while let Some(event_text) = take_sse_block(&mut buffer) {
                            for line in event_text.lines() {
                                if let Some(data) = strip_sse_field(line, "data") {
                                    if data.trim() != "[DONE]" {
                                        if let Ok(json) = serde_json::from_str::<Value>(data) {
                                            let mut guard = events.lock().await;
                                            guard.push(json);
                                        }
                                    }
                                }
                            }
                        }

                        yield Ok(bytes);
                    }
                    Ok(Some(Err(e))) => {
                        log::error!("流error: {e}");
                        yield Err(std::io::Error::other(e.to_string()));
                        break;
                    }
                    Ok(None) => {
                        // 流结束
                        break;
                    }
                    Err(_) => {
                        // 空闲timeout
                        log::warn!("streamingrespuesta空闲timeout: {idle_timeout:?} sin数据");
                        yield Err(std::io::Error::other("Stream idle timeout"));
                        break;
                    }
                }
            }
        }
    }

    /// obtener收集de事件
    pub async fn get_events(&self) -> Vec<Value> {
        let guard = self.events.lock().await;
        guard.clone()
    }

    /// desde收集de事件中提取 Token 使usar量
    pub async fn extract_usage(&self, session: &ProxySession) -> Option<TokenUsage> {
        let events = self.get_events().await;

        match session.client_format {
            super::session::ClientFormat::Claude => TokenUsage::from_claude_stream_events(&events),
            super::session::ClientFormat::Codex => TokenUsage::from_codex_stream_events(&events),
            super::session::ClientFormat::Gemini | super::session::ClientFormat::GeminiCli => {
                TokenUsage::from_gemini_stream_chunks(&events)
            }
            _ => None,
        }
    }
}

/// 非streamingrespuestaprocesar器
#[allow(dead_code)]
pub struct NonStreamHandler;

#[allow(dead_code)]
impl NonStreamHandler {
    /// procesar非streamingrespuesta
    ///
    /// 克隆respuesta体usar/后台analizar，原始respuesta立即retornar
    pub async fn handle_response(
        body: &[u8],
        session: &ProxySession,
    ) -> Result<Option<TokenUsage>, ProxyError> {
        let json: Value = serde_json::from_slice(body)
            .map_err(|e| ProxyError::TransformError(format!("Failed to parse response: {e}")))?;

        let usage = match session.client_format {
            super::session::ClientFormat::Claude => TokenUsage::from_claude_response(&json),
            super::session::ClientFormat::Codex => TokenUsage::from_codex_response_adjusted(&json),
            super::session::ClientFormat::Gemini | super::session::ClientFormat::GeminiCli => {
                TokenUsage::from_gemini_response(&json)
            }
            super::session::ClientFormat::OpenAI => TokenUsage::from_openrouter_response(&json),
            _ => None,
        };

        Ok(usage)
    }
}

/// 统一respuesta分发器
#[allow(dead_code)]
pub struct ResponseDispatcher;

#[allow(dead_code)]
impl ResponseDispatcher {
    /// 判断respuestatipo
    pub fn detect_type(content_type: &str) -> ResponseType {
        ResponseType::from_content_type(content_type)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_response_type_detection() {
        assert_eq!(
            ResponseType::from_content_type("text/event-stream"),
            ResponseType::Stream
        );
        assert_eq!(
            ResponseType::from_content_type("text/event-stream; charset=utf-8"),
            ResponseType::Stream
        );
        assert_eq!(
            ResponseType::from_content_type("application/json"),
            ResponseType::NonStream
        );
    }

    #[test]
    fn test_stream_handler_creation() {
        let handler = StreamHandler::new(30);
        assert_eq!(handler.idle_timeout, Duration::from_secs(30));
    }

    #[test]
    fn test_strip_sse_field_accepts_optional_space() {
        assert_eq!(
            super::strip_sse_field("data: {\"ok\":true}", "data"),
            Some("{\"ok\":true}")
        );
        assert_eq!(
            super::strip_sse_field("data:{\"ok\":true}", "data"),
            Some("{\"ok\":true}")
        );
        assert_eq!(
            super::strip_sse_field("event: message_start", "event"),
            Some("message_start")
        );
        assert_eq!(
            super::strip_sse_field("event:message_start", "event"),
            Some("message_start")
        );
    }
}
