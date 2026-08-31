import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  updateCommonConfigSnippet,
  hasCommonConfigSnippet,
  validateJsonConfig,
} from "@/utils/providerConfigUtils";
import { configApi } from "@/lib/api";

const LEGACY_STORAGE_KEY = "resuelve-api:common-config-snippet";
const DEFAULT_COMMON_CONFIG_SNIPPET = `{
  "includeCoAuthoredBy": false
}`;

interface UseCommonConfigSnippetProps {
  settingsConfig: string;
  onConfigChange: (config: string) => void;
  initialData?: {
    settingsConfig?: Record<string, unknown>;
  };
  initialEnabled?: boolean;
  selectedPresetId?: string;
  /** When false, the hook skips all logic and returns disabled state. Default: true */
  enabled?: boolean;
}

/**
 * Gestionar fragmento de configuración común de Claude
 * Leer y guardar desde config.json, soporta migración suave desde localStorage
 */
export function useCommonConfigSnippet({
  settingsConfig,
  onConfigChange,
  initialData,
  initialEnabled,
  selectedPresetId,
  enabled = true,
}: UseCommonConfigSnippetProps) {
  const { t } = useTranslation();
  const [useCommonConfig, setUseCommonConfig] = useState(false);
  const [commonConfigSnippet, setCommonConfigSnippetState] = useState<string>(
    DEFAULT_COMMON_CONFIG_SNIPPET,
  );
  const [commonConfigError, setCommonConfigError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isExtracting, setIsExtracting] = useState(false);

  // Para rastrear si se está actualizando mediante configuración común
  const isUpdatingFromCommonConfig = useRef(false);
  // Para rastrear si el modo de creación ha inicializado la selección predeterminada
  const hasInitializedNewMode = useRef(false);
  // Para rastrear si el modo de edición ha inicializado el interruptor explícito/vista previa
  const hasInitializedEditMode = useRef(false);

  // Al cambiar preset, restablecer marca de inicialización para que el nuevo preset pueda volver a activar la lógica de inicialización
  useEffect(() => {
    if (!enabled) return;
    hasInitializedNewMode.current = false;
    hasInitializedEditMode.current = false;
  }, [selectedPresetId, enabled, initialEnabled]);

  // Inicialización: cargar desde config.json, soporta migración desde localStorage
  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }
    let mounted = true;

    const loadSnippet = async () => {
      try {
        // Cargar usando API unificada
        const snippet = await configApi.getCommonConfigSnippet("claude");

        if (snippet && snippet.trim()) {
          if (mounted) {
            setCommonConfigSnippetState(snippet);
          }
        } else {
          // Si no está en config.json, intentar migrar desde localStorage
          if (typeof window !== "undefined") {
            try {
              const legacySnippet =
                window.localStorage.getItem(LEGACY_STORAGE_KEY);
              if (legacySnippet && legacySnippet.trim()) {
                // Migrar a config.json
                await configApi.setCommonConfigSnippet("claude", legacySnippet);
                if (mounted) {
                  setCommonConfigSnippetState(legacySnippet);
                }
                // Limpiar localStorage
                window.localStorage.removeItem(LEGACY_STORAGE_KEY);
                console.log(
                  "[Migración] Configuración común de Claude migrada de localStorage a config.json",
                );
              }
            } catch (e) {
              console.warn("[Migración] Falló la migración desde localStorage:", e);
            }
          }
        }
      } catch (error) {
        console.error("Falló la carga de configuración común:", error);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    loadSnippet();

    return () => {
      mounted = false;
    };
  }, [enabled]);

  // Al inicializar, verificar fragmento de configuración común (modo edición)
  useEffect(() => {
    if (!enabled) return;
    if (initialData && !isLoading && !hasInitializedEditMode.current) {
      hasInitializedEditMode.current = true;

      const configString = JSON.stringify(initialData.settingsConfig, null, 2);
      const inferredHasCommon = hasCommonConfigSnippet(
        configString,
        commonConfigSnippet,
      );

      // Prioridad: initialEnabled configurado explícitamente > valor inferido de configuración
      // Si initialEnabled es undefined, usar valor inferido
      const hasCommon =
        initialEnabled !== undefined ? initialEnabled : inferredHasCommon;
      setUseCommonConfig(hasCommon);

      // Si debe activarse la configuración común pero aún no está en la configuración, agregar automáticamente
      if (hasCommon && !inferredHasCommon) {
        const { updatedConfig, error } = updateCommonConfigSnippet(
          settingsConfig,
          commonConfigSnippet,
          true,
        );
        if (!error) {
          isUpdatingFromCommonConfig.current = true;
          onConfigChange(updatedConfig);
          setTimeout(() => {
            isUpdatingFromCommonConfig.current = false;
          }, 0);
        }
      }
    }
  }, [
    enabled,
    initialData,
    initialEnabled,
    commonConfigSnippet,
    isLoading,
    onConfigChange,
    settingsConfig,
  ]);

  // Modo creación: si el fragmento de configuración común existe y es válido, activar por defecto
  useEffect(() => {
    if (!enabled) return;
    // Solo modo creación, carga completa, aún no inicializado
    if (!initialData && !isLoading && !hasInitializedNewMode.current) {
      hasInitializedNewMode.current = true;

      // Verificar si el fragmento tiene contenido sustancial
      try {
        const snippetObj = JSON.parse(commonConfigSnippet);
        const hasContent = Object.keys(snippetObj).length > 0;
        if (hasContent) {
          setUseCommonConfig(true);
          // Fusionar configuración común en configuración actual
          const { updatedConfig, error } = updateCommonConfigSnippet(
            settingsConfig,
            commonConfigSnippet,
            true,
          );
          if (!error) {
            isUpdatingFromCommonConfig.current = true;
            onConfigChange(updatedConfig);
            setTimeout(() => {
              isUpdatingFromCommonConfig.current = false;
            }, 0);
          }
        }
      } catch {
        // ignore parse error
      }
    }
  }, [
    enabled,
    initialData,
    commonConfigSnippet,
    isLoading,
    settingsConfig,
    onConfigChange,
  ]);

  // Manejar interruptor de configuración común
  const handleCommonConfigToggle = useCallback(
    (checked: boolean) => {
      const { updatedConfig, error: snippetError } = updateCommonConfigSnippet(
        settingsConfig,
        commonConfigSnippet,
        checked,
      );

      if (snippetError) {
        setCommonConfigError(snippetError);
        setUseCommonConfig(false);
        return;
      }

      setCommonConfigError("");
      setUseCommonConfig(checked);
      // Marcar que se está actualizando mediante configuración común
      isUpdatingFromCommonConfig.current = true;
      onConfigChange(updatedConfig);
      // Restablecer marca en el siguiente ciclo de eventos
      setTimeout(() => {
        isUpdatingFromCommonConfig.current = false;
      }, 0);
    },
    [settingsConfig, commonConfigSnippet, onConfigChange],
  );

  // Manejar cambios en fragmento de configuración común
  const handleCommonConfigSnippetChange = useCallback(
    (value: string) => {
      const previousSnippet = commonConfigSnippet;
      setCommonConfigSnippetState(value);

      if (!value.trim()) {
        setCommonConfigError("");
        // Guardar a config.json (vaciar)
        configApi
          .setCommonConfigSnippet("claude", "")
          .catch((error: unknown) => {
            console.error("Falló guardar configuración común:", error);
            setCommonConfigError(
              t("claudeConfig.saveFailed", { error: String(error) }),
            );
          });

        if (useCommonConfig) {
          const { updatedConfig } = updateCommonConfigSnippet(
            settingsConfig,
            previousSnippet,
            false,
          );
          onConfigChange(updatedConfig);
          setUseCommonConfig(false);
        }
        return;
      }

      // Validar formato JSON
      const validationError = validateJsonConfig(value, "fragmento de configuración común");
      if (validationError) {
        setCommonConfigError(validationError);
      } else {
        setCommonConfigError("");
        // Guardar a config.json
        configApi
          .setCommonConfigSnippet("claude", value)
          .catch((error: unknown) => {
            console.error("Falló guardar configuración común:", error);
            setCommonConfigError(
              t("claudeConfig.saveFailed", { error: String(error) }),
            );
          });
      }

      // Si la configuración común está actualmente activada y el formato es correcto, necesita reemplazarse con el fragmento más reciente
      if (useCommonConfig && !validationError) {
        const removeResult = updateCommonConfigSnippet(
          settingsConfig,
          previousSnippet,
          false,
        );
        if (removeResult.error) {
          setCommonConfigError(removeResult.error);
          return;
        }
        const addResult = updateCommonConfigSnippet(
          removeResult.updatedConfig,
          value,
          true,
        );

        if (addResult.error) {
          setCommonConfigError(addResult.error);
          return;
        }

        // Marcar que se está actualizando mediante configuración común, evitar activar verificación de estado
        isUpdatingFromCommonConfig.current = true;
        onConfigChange(addResult.updatedConfig);
        // Restablecer marca en el siguiente ciclo de eventos
        setTimeout(() => {
          isUpdatingFromCommonConfig.current = false;
        }, 0);
      }
    },
    [commonConfigSnippet, settingsConfig, useCommonConfig, onConfigChange],
  );

  // Al cambiar configuración, verificar si contiene configuración común (pero evitar verificar al actualizar mediante configuración común)
  useEffect(() => {
    if (!enabled) return;
    if (isUpdatingFromCommonConfig.current || isLoading) {
      return;
    }
    const hasCommon = hasCommonConfigSnippet(
      settingsConfig,
      commonConfigSnippet,
    );
    setUseCommonConfig(hasCommon);
  }, [enabled, settingsConfig, commonConfigSnippet, isLoading]);

  // Extraer el fragmento de configuración común del contenido actual del editor
  const handleExtract = useCallback(async () => {
    setIsExtracting(true);
    setCommonConfigError("");

    try {
      const extracted = await configApi.extractCommonConfigSnippet("claude", {
        settingsConfig,
      });

      if (!extracted || extracted === "{}") {
        setCommonConfigError(t("claudeConfig.extractNoCommonConfig"));
        return;
      }

      // Validar formato JSON
      const validationError = validateJsonConfig(extracted, "configuración extraída");
      if (validationError) {
        setCommonConfigError(validationError);
        return;
      }

      // Actualizar estado del fragmento
      setCommonConfigSnippetState(extracted);

      // Guardar en backend
      await configApi.setCommonConfigSnippet("claude", extracted);
    } catch (error) {
      console.error("Falló extraer configuración común:", error);
      setCommonConfigError(
        t("claudeConfig.extractFailed", { error: String(error) }),
      );
    } finally {
      setIsExtracting(false);
    }
  }, [settingsConfig, t]);

  return {
    useCommonConfig,
    commonConfigSnippet,
    commonConfigError,
    isLoading,
    isExtracting,
    handleCommonConfigToggle,
    handleCommonConfigSnippetChange,
    handleExtract,
  };
}
