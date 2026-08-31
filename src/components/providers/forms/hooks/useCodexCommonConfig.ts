import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { parse as parseToml } from "smol-toml";
import {
  updateTomlCommonConfigSnippet,
  hasTomlCommonConfigSnippet,
} from "@/utils/providerConfigUtils";
import { configApi } from "@/lib/api";
import { normalizeTomlText } from "@/utils/textNormalization";

const LEGACY_STORAGE_KEY = "resuelve-api:codex-common-config-snippet";
const DEFAULT_CODEX_COMMON_CONFIG_SNIPPET = `# Common Codex config
# Add your common TOML configuration here`;

interface UseCodexCommonConfigProps {
  codexConfig: string;
  onConfigChange: (config: string) => void;
  initialData?: {
    settingsConfig?: Record<string, unknown>;
  };
  initialEnabled?: boolean;
  selectedPresetId?: string;
}

/**
 * Gestionar fragmentos de configuración común de Codex (formato TOML)
 * Leer y guardar desde config.json, con migración suave desde localStorage
 */
export function useCodexCommonConfig({
  codexConfig,
  onConfigChange,
  initialData,
  initialEnabled,
  selectedPresetId,
}: UseCodexCommonConfigProps) {
  const { t } = useTranslation();
  const [useCommonConfig, setUseCommonConfig] = useState(false);
  const [commonConfigSnippet, setCommonConfigSnippetState] = useState<string>(
    DEFAULT_CODEX_COMMON_CONFIG_SNIPPET,
  );
  const [commonConfigError, setCommonConfigError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isExtracting, setIsExtracting] = useState(false);

  // Seguimiento de si se está actualizando mediante configuración común
  const isUpdatingFromCommonConfig = useRef(false);
  // Seguimiento de si modo creación ha inicializado selección predeterminada
  const hasInitializedNewMode = useRef(false);
  // Seguimiento de si modo edición ha inicializado interruptor explícito/vista previa
  const hasInitializedEditMode = useRef(false);

  // Al cambiar preset, restablecer marcas de inicialización para que el nuevo preset pueda volver a activar la lógica de inicialización
  useEffect(() => {
    hasInitializedNewMode.current = false;
    hasInitializedEditMode.current = false;
  }, [selectedPresetId, initialEnabled]);

  const parseCommonConfigSnippet = useCallback((snippetString: string) => {
    const trimmed = snippetString.trim();
    if (!trimmed) {
      return {
        hasContent: false,
      };
    }

    try {
      const parsed = parseToml(normalizeTomlText(snippetString)) as Record<
        string,
        unknown
      >;
      return {
        hasContent: Object.keys(parsed).length > 0,
      };
    } catch (error) {
      return {
        hasContent: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, []);

  // Inicialización: cargar desde config.json, con migración desde localStorage
  useEffect(() => {
    let mounted = true;

    const loadSnippet = async () => {
      try {
        // Usar API unificada para cargar
        const snippet = await configApi.getCommonConfigSnippet("codex");

        if (snippet && snippet.trim()) {
          if (mounted) {
            setCommonConfigSnippetState(snippet);
          }
        } else {
          // Si no está en config.json, intentar migración desde localStorage
          if (typeof window !== "undefined") {
            try {
              const legacySnippet =
                window.localStorage.getItem(LEGACY_STORAGE_KEY);
              if (legacySnippet && legacySnippet.trim()) {
                // Migrar a config.json
                await configApi.setCommonConfigSnippet("codex", legacySnippet);
                if (mounted) {
                  setCommonConfigSnippetState(legacySnippet);
                }
                // Limpiar localStorage
                window.localStorage.removeItem(LEGACY_STORAGE_KEY);
                console.log(
                  "[Migración] Configuración común de Codex migrada de localStorage a config.json",
                );
              }
            } catch (e) {
              console.warn("[Migración] Fallo al migrar desde localStorage:", e);
            }
          }
        }
      } catch (error) {
        console.error("Fallo al cargar configuración común de Codex:", error);
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
  }, []);

  // Al inicializar, verificar fragmento de configuración común (modo edición)
  useEffect(() => {
    if (
      !initialData?.settingsConfig ||
      isLoading ||
      hasInitializedEditMode.current
    ) {
      return;
    }

    hasInitializedEditMode.current = true;

    const parsedSnippet = parseCommonConfigSnippet(commonConfigSnippet);
    if (parsedSnippet.error) {
      if (commonConfigSnippet.trim()) {
        setCommonConfigError(parsedSnippet.error);
      }
      setUseCommonConfig(false);
      return;
    }

    const config =
      typeof initialData.settingsConfig.config === "string"
        ? initialData.settingsConfig.config
        : "";
    const inferredHasCommon = hasTomlCommonConfigSnippet(
      config,
      commonConfigSnippet,
    );

    // Prioridad: initialEnabled explícito > valor inferido de configuración
    // Si initialEnabled es undefined, usar valor inferido
    const hasCommon =
      initialEnabled !== undefined ? initialEnabled : inferredHasCommon;

    // Si debe habilitarse configuración común pero aún no está en config, agregar automáticamente
    if (hasCommon && !inferredHasCommon && parsedSnippet.hasContent) {
      const { updatedConfig, error } = updateTomlCommonConfigSnippet(
        codexConfig,
        commonConfigSnippet,
        true,
      );
      if (error) {
        setCommonConfigError(error);
        setUseCommonConfig(false);
        return;
      }

      setCommonConfigError("");
      setUseCommonConfig(true);
      isUpdatingFromCommonConfig.current = true;
      onConfigChange(updatedConfig);
      setTimeout(() => {
        isUpdatingFromCommonConfig.current = false;
      }, 0);
      return;
    }

    setCommonConfigError("");
    setUseCommonConfig(hasCommon);
  }, [
    codexConfig,
    commonConfigSnippet,
    initialData,
    initialEnabled,
    isLoading,
    onConfigChange,
    parseCommonConfigSnippet,
  ]);

  // Modo creación: si fragmento de configuración común existe y es válido, habilitar por defecto
  useEffect(() => {
    if (initialData || isLoading || hasInitializedNewMode.current) {
      return;
    }

    hasInitializedNewMode.current = true;

    const parsedSnippet = parseCommonConfigSnippet(commonConfigSnippet);
    if (parsedSnippet.error) {
      if (commonConfigSnippet.trim()) {
        setCommonConfigError(parsedSnippet.error);
      }
      setUseCommonConfig(false);
      return;
    }
    if (!parsedSnippet.hasContent) {
      return;
    }

    const { updatedConfig, error } = updateTomlCommonConfigSnippet(
      codexConfig,
      commonConfigSnippet,
      true,
    );
    if (error) {
      setCommonConfigError(error);
      setUseCommonConfig(false);
      return;
    }

    setCommonConfigError("");
    setUseCommonConfig(true);
    isUpdatingFromCommonConfig.current = true;
    onConfigChange(updatedConfig);
    setTimeout(() => {
      isUpdatingFromCommonConfig.current = false;
    }, 0);
  }, [
    initialData,
    commonConfigSnippet,
    isLoading,
    codexConfig,
    onConfigChange,
    parseCommonConfigSnippet,
  ]);

  // Manejar interruptor de configuración común
  const handleCommonConfigToggle = useCallback(
    (checked: boolean) => {
      const parsedSnippet = parseCommonConfigSnippet(commonConfigSnippet);
      if (parsedSnippet.error) {
        setCommonConfigError(parsedSnippet.error);
        setUseCommonConfig(false);
        return;
      }
      if (!parsedSnippet.hasContent) {
        setCommonConfigError(
          t("codexConfig.noCommonConfigToApply", {
            defaultValue: "El fragmento de configuración común está vacío o no tiene contenido para escribir",
          }),
        );
        setUseCommonConfig(false);
        return;
      }

      const { updatedConfig, error: snippetError } =
        updateTomlCommonConfigSnippet(
          codexConfig,
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
      // Restablecer marca en siguiente ciclo de eventos
      setTimeout(() => {
        isUpdatingFromCommonConfig.current = false;
      }, 0);
    },
    [
      codexConfig,
      commonConfigSnippet,
      onConfigChange,
      parseCommonConfigSnippet,
      t,
    ],
  );

  // Manejar cambio de fragmento de configuración común
  const handleCommonConfigSnippetChange = useCallback(
    (value: string): boolean => {
      const previousSnippet = commonConfigSnippet;

      if (!value.trim()) {
        setCommonConfigError("");

        if (useCommonConfig) {
          const previousParsed = parseCommonConfigSnippet(previousSnippet);
          let updatedConfig = codexConfig;

          if (!previousParsed.error && previousParsed.hasContent) {
            const removeResult = updateTomlCommonConfigSnippet(
              codexConfig,
              previousSnippet,
              false,
            );
            if (removeResult.error) {
              setCommonConfigError(removeResult.error);
              return false;
            }
            updatedConfig = removeResult.updatedConfig;
          }

          onConfigChange(updatedConfig);
          setUseCommonConfig(false);
        }

        setCommonConfigSnippetState("");
        configApi
          .setCommonConfigSnippet("codex", "")
          .catch((error: unknown) => {
            console.error("Fallo al guardar configuración común de Codex:", error);
            setCommonConfigError(
              t("codexConfig.saveFailed", { error: String(error) }),
            );
          });
        return true;
      }

      const parsedNextSnippet = parseCommonConfigSnippet(value);
      if (parsedNextSnippet.error) {
        setCommonConfigError(parsedNextSnippet.error);
        return false;
      }

      // Si configuración común está habilitada, reemplazar con fragmento más reciente
      if (useCommonConfig) {
        let nextConfig = codexConfig;
        const previousParsed = parseCommonConfigSnippet(previousSnippet);

        if (!previousParsed.error && previousParsed.hasContent) {
          const removeResult = updateTomlCommonConfigSnippet(
            codexConfig,
            previousSnippet,
            false,
          );
          if (removeResult.error) {
            setCommonConfigError(removeResult.error);
            return false;
          }
          nextConfig = removeResult.updatedConfig;
        }

        const addResult = updateTomlCommonConfigSnippet(
          nextConfig,
          value,
          true,
        );

        if (addResult.error) {
          setCommonConfigError(addResult.error);
          return false;
        }

        // Marcar que se está actualizando mediante configuración común, para no disparar la comprobación de estado
        isUpdatingFromCommonConfig.current = true;
        onConfigChange(addResult.updatedConfig);
        // Restablecer marca en siguiente ciclo de eventos
        setTimeout(() => {
          isUpdatingFromCommonConfig.current = false;
        }, 0);
      }

      setCommonConfigError("");
      setCommonConfigSnippetState(value);
      configApi
        .setCommonConfigSnippet("codex", value)
        .catch((error: unknown) => {
          console.error("Fallo al guardar configuración común de Codex:", error);
          setCommonConfigError(
            t("codexConfig.saveFailed", { error: String(error) }),
          );
        });

      return true;
    },
    [
      commonConfigSnippet,
      codexConfig,
      onConfigChange,
      parseCommonConfigSnippet,
      t,
      useCommonConfig,
    ],
  );

  // Al cambiar configuración, verificar si incluye configuración común (evitar verificar durante actualización por configuración común)
  useEffect(() => {
    if (isUpdatingFromCommonConfig.current || isLoading) {
      return;
    }
    const parsedSnippet = parseCommonConfigSnippet(commonConfigSnippet);
    if (parsedSnippet.error) {
      setUseCommonConfig(false);
      return;
    }
    const hasCommon = hasTomlCommonConfigSnippet(
      codexConfig,
      commonConfigSnippet,
    );
    setUseCommonConfig(hasCommon);
  }, [codexConfig, commonConfigSnippet, isLoading, parseCommonConfigSnippet]);

  // Extraer fragmento de configuración común del contenido actual del editor
  const handleExtract = useCallback(async () => {
    setIsExtracting(true);
    setCommonConfigError("");

    try {
      const extracted = await configApi.extractCommonConfigSnippet("codex", {
        settingsConfig: JSON.stringify({
          config: codexConfig ?? "",
        }),
      });

      if (!extracted || !extracted.trim()) {
        setCommonConfigError(t("codexConfig.extractNoCommonConfig"));
        return;
      }

      // Actualizar estado de fragmento
      setCommonConfigSnippetState(extracted);

      // Guardar en backend
      await configApi.setCommonConfigSnippet("codex", extracted);
    } catch (error) {
      console.error("Fallo al extraer configuración común de Codex:", error);
      setCommonConfigError(
        t("codexConfig.extractFailed", { error: String(error) }),
      );
    } finally {
      setIsExtracting(false);
    }
  }, [codexConfig, t]);

  const clearCommonConfigError = useCallback(() => {
    setCommonConfigError("");
  }, []);

  return {
    useCommonConfig,
    commonConfigSnippet,
    commonConfigError,
    isLoading,
    isExtracting,
    handleCommonConfigToggle,
    handleCommonConfigSnippetChange,
    handleExtract,
    clearCommonConfigError,
  };
}
