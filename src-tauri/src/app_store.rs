use serde_json::Value;
use std::path::PathBuf;
use std::sync::{OnceLock, RwLock};
use tauri_plugin_store::StoreExt;

use crate::error::AppError;

/// Nombre de clave en Store
const STORE_KEY_APP_CONFIG_DIR: &str = "app_config_dir_override";

/// Caché de la ruta de sobrescritura de app_config_dir actual, evita almacenar AppHandle
static APP_CONFIG_DIR_OVERRIDE: OnceLock<RwLock<Option<PathBuf>>> = OnceLock::new();

fn override_cache() -> &'static RwLock<Option<PathBuf>> {
    APP_CONFIG_DIR_OVERRIDE.get_or_init(|| RwLock::new(None))
}

fn update_cached_override(value: Option<PathBuf>) {
    if let Ok(mut guard) = override_cache().write() {
        *guard = value;
    }
}

/// Obtener ruta de sobrescritura de app_config_dir desde la caché
pub fn get_app_config_dir_override() -> Option<PathBuf> {
    override_cache().read().ok()?.clone()
}

fn read_override_from_store(app: &tauri::AppHandle) -> Option<PathBuf> {
    let store = match app.store_builder("app_paths.json").build() {
        Ok(store) => store,
        Err(e) => {
            log::warn!("No se puede crear Store: {e}");
            return None;
        }
    };

    match store.get(STORE_KEY_APP_CONFIG_DIR) {
        Some(Value::String(path_str)) => {
            let path_str = path_str.trim();
            if path_str.is_empty() {
                return None;
            }

            let path = resolve_path(path_str);

            if !path.exists() {
                log::warn!(
                    "app_config_dir configurado en Store no existe: {path:?}\n\
                     Se usará la ruta predeterminada."
                );
                return None;
            }

            log::info!("Usando app_config_dir de Store: {path:?}");
            Some(path)
        }
        Some(_) => {
            log::warn!("El tipo de {STORE_KEY_APP_CONFIG_DIR} en Store es incorrecto, debe ser string");
            None
        }
        None => None,
    }
}

/// Refrescar valor de sobrescritura de app_config_dir desde Store y actualizar caché
pub fn refresh_app_config_dir_override(app: &tauri::AppHandle) -> Option<PathBuf> {
    let value = read_override_from_store(app);
    update_cached_override(value.clone());
    value
}

/// Escribir app_config_dir a Tauri Store
pub fn set_app_config_dir_to_store(
    app: &tauri::AppHandle,
    path: Option<&str>,
) -> Result<(), AppError> {
    let store = app
        .store_builder("app_paths.json")
        .build()
        .map_err(|e| AppError::Message(format!("Error al crear Store: {e}")))?;

    match path {
        Some(p) => {
            let trimmed = p.trim();
            if !trimmed.is_empty() {
                store.set(STORE_KEY_APP_CONFIG_DIR, Value::String(trimmed.to_string()));
                log::info!("app_config_dir escrito a Store: {trimmed}");
            } else {
                store.delete(STORE_KEY_APP_CONFIG_DIR);
                log::info!("Configuración de app_config_dir eliminada de Store");
            }
        }
        None => {
            store.delete(STORE_KEY_APP_CONFIG_DIR);
            log::info!("Configuración de app_config_dir eliminada de Store");
        }
    }

    store
        .save()
        .map_err(|e| AppError::Message(format!("Error al guardar Store: {e}")))?;

    refresh_app_config_dir_override(app);
    Ok(())
}

/// Analizar ruta, soporta rutas relativas que comienzan con ~
fn resolve_path(raw: &str) -> PathBuf {
    if raw == "~" {
        if let Some(home) = dirs::home_dir() {
            return home;
        }
    } else if let Some(stripped) = raw.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(stripped);
        }
    } else if let Some(stripped) = raw.strip_prefix("~\\") {
        if let Some(home) = dirs::home_dir() {
            return home.join(stripped);
        }
    }

    PathBuf::from(raw)
}

/// Migrar app_config_dir desde settings.json antiguo a Store
pub fn migrate_app_config_dir_from_settings(app: &tauri::AppHandle) -> Result<(), AppError> {
    // app_config_dir ya fue eliminado de settings.json, esta función se mantiene pero ya no ejecuta migración
    // Si el usuario configuró app_config_dir en versiones antiguas, debe reconfigurarlo manualmente en Store
    log::info!("Funcionalidad de migración de app_config_dir eliminada, por favor reconfigure en ajustes");

    let _ = refresh_app_config_dir_override(app);
    Ok(())
}
