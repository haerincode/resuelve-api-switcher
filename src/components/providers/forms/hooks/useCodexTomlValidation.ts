import { useState, useCallback, useEffect, useRef } from "react";
import TOML from "smol-toml";

/**
 * Hook para validación de formato config.toml de Codex
 * Usar smol-toml para validación de sintaxis TOML en tiempo real (con debounce)
 */
export function useCodexTomlValidation() {
  const [configError, setConfigError] = useState("");
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Validar formato TOML
   * @param tomlText - Texto TOML a validar
   * @returns Si la validación pasó
   */
  const validateToml = useCallback((tomlText: string): boolean => {
    // Cadena vacía se considera válida (permitir vacío)
    if (!tomlText.trim()) {
      setConfigError("");
      return true;
    }

    try {
      TOML.parse(tomlText);
      setConfigError("");
      return true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Error de formato TOML";
      setConfigError(errorMessage);
      return false;
    }
  }, []);

  /**
   * Función de validación con debounce (retraso de 500ms)
   * @param tomlText - Texto TOML a validar
   */
  const debouncedValidate = useCallback(
    (tomlText: string) => {
      // Limpiar temporizador anterior
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // Establecer nuevo temporizador
      debounceTimerRef.current = setTimeout(() => {
        validateToml(tomlText);
      }, 500);
    },
    [validateToml],
  );

  /**
   * Limpiar mensaje de error
   */
  const clearError = useCallback(() => {
    setConfigError("");
  }, []);

  // Limpiar temporizador
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return {
    configError,
    validateToml,
    debouncedValidate,
    clearError,
  };
}
