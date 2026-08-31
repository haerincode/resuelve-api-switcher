import {
  useCircuitBreakerConfig,
  useUpdateCircuitBreakerConfig,
} from "@/lib/query/failover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

/**
 * Panel de configuración del circuit breaker
 * Permite al usuario ajustar los parámetros del circuit breaker
 */
export function CircuitBreakerConfigPanel() {
  const { t } = useTranslation();
  const { data: config, isLoading } = useCircuitBreakerConfig();
  const updateConfig = useUpdateCircuitBreakerConfig();

  // Usar estado de string para soportar campos vacíos
  const [formData, setFormData] = useState({
    failureThreshold: "5",
    successThreshold: "2",
    timeoutSeconds: "60",
    errorRateThreshold: "50", // Almacena valor porcentual
    minRequests: "10",
  });

  // Actualizar datos del formulario cuando la configuración se carga
  useEffect(() => {
    if (config) {
      setFormData({
        failureThreshold: String(config.failureThreshold),
        successThreshold: String(config.successThreshold),
        timeoutSeconds: String(config.timeoutSeconds),
        errorRateThreshold: String(Math.round(config.errorRateThreshold * 100)),
        minRequests: String(config.minRequests),
      });
    }
  }, [config]);

  const handleSave = async () => {
    // Parsear números, retorna NaN para entrada inválida
    const parseNum = (val: string) => {
      const trimmed = val.trim();
      // Debe ser solo números
      if (!/^-?\d+$/.test(trimmed)) return NaN;
      return parseInt(trimmed);
    };

    // Definir rangos válidos para cada campo
    const ranges = {
      failureThreshold: { min: 1, max: 20 },
      successThreshold: { min: 1, max: 10 },
      timeoutSeconds: { min: 0, max: 300 },
      errorRateThreshold: { min: 0, max: 100 },
      minRequests: { min: 5, max: 100 },
    };

    // Parsear valores crudos
    const raw = {
      failureThreshold: parseNum(formData.failureThreshold),
      successThreshold: parseNum(formData.successThreshold),
      timeoutSeconds: parseNum(formData.timeoutSeconds),
      errorRateThreshold: parseNum(formData.errorRateThreshold),
      minRequests: parseNum(formData.minRequests),
    };

    // Validar si está fuera del rango (NaN también se considera inválido)
    const errors: string[] = [];
    const checkRange = (
      value: number,
      range: { min: number; max: number },
      label: string,
    ) => {
      if (isNaN(value) || value < range.min || value > range.max) {
        errors.push(`${label}: ${range.min}-${range.max}`);
      }
    };

    checkRange(
      raw.failureThreshold,
      ranges.failureThreshold,
      t("circuitBreaker.failureThreshold", "Umbral de fallos"),
    );
    checkRange(
      raw.successThreshold,
      ranges.successThreshold,
      t("circuitBreaker.successThreshold", "Umbral de éxitos"),
    );
    checkRange(
      raw.timeoutSeconds,
      ranges.timeoutSeconds,
      t("circuitBreaker.timeoutSeconds", "Tiempo de espera"),
    );
    checkRange(
      raw.errorRateThreshold,
      ranges.errorRateThreshold,
      t("circuitBreaker.errorRateThreshold", "Umbral de tasa de error"),
    );
    checkRange(
      raw.minRequests,
      ranges.minRequests,
      t("circuitBreaker.minRequests", "Solicitudes mínimas"),
    );

    if (errors.length > 0) {
      toast.error(
        t("circuitBreaker.validationFailed", {
          fields: errors.join("; "),
          defaultValue: `Los siguientes campos están fuera del rango válido: ${errors.join("; ")}`,
        }),
      );
      return;
    }

    try {
      await updateConfig.mutateAsync({
        failureThreshold: raw.failureThreshold,
        successThreshold: raw.successThreshold,
        timeoutSeconds: raw.timeoutSeconds,
        errorRateThreshold: raw.errorRateThreshold / 100,
        minRequests: raw.minRequests,
      });
      toast.success(t("circuitBreaker.configSaved", "Configuración de circuit breaker guardada"), {
        closeButton: true,
      });
    } catch (error) {
      toast.error(
        t("circuitBreaker.saveFailed", "Error al guardar") + ": " + String(error),
      );
    }
  };

  const handleReset = () => {
    if (config) {
      setFormData({
        failureThreshold: String(config.failureThreshold),
        successThreshold: String(config.successThreshold),
        timeoutSeconds: String(config.timeoutSeconds),
        errorRateThreshold: String(Math.round(config.errorRateThreshold * 100)),
        minRequests: String(config.minRequests),
      });
    }
  };

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground">
        {t("circuitBreaker.loading", "Cargando...")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">
          {t("circuitBreaker.title", "Configuración de Circuit Breaker")}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          {t(
            "circuitBreaker.description",
            "Ajustar parámetros del circuit breaker para controlar detección y recuperación de fallos",
          )}
        </p>
      </div>

      <div className="h-px bg-border my-4" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Umbral de fallos */}
        <div className="space-y-2">
          <Label htmlFor="failureThreshold">
            {t("circuitBreaker.failureThreshold", "Umbral de fallos")}
          </Label>
          <Input
            id="failureThreshold"
            type="number"
            min="1"
            max="20"
            value={formData.failureThreshold}
            onChange={(e) =>
              setFormData({ ...formData, failureThreshold: e.target.value })
            }
          />
          <p className="text-xs text-muted-foreground">
            {t(
              "circuitBreaker.failureThresholdHint",
              "Después de cuántos fallos consecutivos se abre el circuit breaker",
            )}
          </p>
        </div>

        {/* Tiempo de espera */}
        <div className="space-y-2">
          <Label htmlFor="timeoutSeconds">
            {t("circuitBreaker.timeoutSeconds", "Tiempo de espera (s)")}
          </Label>
          <Input
            id="timeoutSeconds"
            type="number"
            min="0"
            max="300"
            value={formData.timeoutSeconds}
            onChange={(e) =>
              setFormData({ ...formData, timeoutSeconds: e.target.value })
            }
          />
          <p className="text-xs text-muted-foreground">
            {t(
              "circuitBreaker.timeoutSecondsHint",
              "Después de abierto el circuit breaker, cuánto tiempo antes de intentar recuperar (estado semi-abierto)",
            )}
          </p>
        </div>

        {/* Umbral de éxitos */}
        <div className="space-y-2">
          <Label htmlFor="successThreshold">
            {t("circuitBreaker.successThreshold", "Umbral de éxitos")}
          </Label>
          <Input
            id="successThreshold"
            type="number"
            min="1"
            max="10"
            value={formData.successThreshold}
            onChange={(e) =>
              setFormData({ ...formData, successThreshold: e.target.value })
            }
          />
          <p className="text-xs text-muted-foreground">
            {t(
              "circuitBreaker.successThresholdHint",
              "Cuántos éxitos en estado semi-abierto cierran el circuit breaker",
            )}
          </p>
        </div>

        {/* Umbral de tasa de error */}
        <div className="space-y-2">
          <Label htmlFor="errorRateThreshold">
            {t("circuitBreaker.errorRateThreshold", "Umbral de tasa de error (%)")}
          </Label>
          <Input
            id="errorRateThreshold"
            type="number"
            min="0"
            max="100"
            step="5"
            value={formData.errorRateThreshold}
            onChange={(e) =>
              setFormData({ ...formData, errorRateThreshold: e.target.value })
            }
          />
          <p className="text-xs text-muted-foreground">
            {t(
              "circuitBreaker.errorRateThresholdHint",
              "Abrir circuit breaker cuando la tasa de error supera este valor",
            )}
          </p>
        </div>

        {/* Solicitudes mínimas */}
        <div className="space-y-2">
          <Label htmlFor="minRequests">
            {t("circuitBreaker.minRequests", "Solicitudes mínimas")}
          </Label>
          <Input
            id="minRequests"
            type="number"
            min="5"
            max="100"
            value={formData.minRequests}
            onChange={(e) =>
              setFormData({ ...formData, minRequests: e.target.value })
            }
          />
          <p className="text-xs text-muted-foreground">
            {t("circuitBreaker.minRequestsHint", "Número mínimo de solicitudes antes de calcular tasa de error")}
          </p>
        </div>
      </div>

      <div className="flex gap-3">
        <Button onClick={handleSave} disabled={updateConfig.isPending}>
          {updateConfig.isPending
            ? t("common.saving", "Guardando...")
            : t("circuitBreaker.saveConfig", "Guardar configuración")}
        </Button>
        <Button
          variant="outline"
          onClick={handleReset}
          disabled={updateConfig.isPending}
        >
          {t("common.reset", "Restablecer")}
        </Button>
      </div>

      {/* Información explicativa */}
      <div className="p-4 bg-muted/50 rounded-lg space-y-2 text-sm">
        <h4 className="font-medium">
          {t("circuitBreaker.instructionsTitle", "Instrucciones de configuración")}
        </h4>
        <ul className="space-y-1 text-muted-foreground">
          <li>
            •{" "}
            <strong>{t("circuitBreaker.failureThreshold", "Umbral de fallos")}</strong>
            :{" "}
            {t(
              "circuitBreaker.instructions.failureThreshold",
              "Cuando los fallos consecutivos alcanzan este número, el circuit breaker se abre",
            )}
          </li>
          <li>
            • <strong>{t("circuitBreaker.timeoutSeconds", "Tiempo de espera")}</strong>
            :{" "}
            {t(
              "circuitBreaker.instructions.timeout",
              "Después de abrirse el circuit breaker, esperar este tiempo antes de intentar estado semi-abierto",
            )}
          </li>
          <li>
            •{" "}
            <strong>{t("circuitBreaker.successThreshold", "Umbral de éxitos")}</strong>
            :{" "}
            {t(
              "circuitBreaker.instructions.successThreshold",
              "En estado semi-abierto, cuando los éxitos alcanzan este número se cierra el circuit breaker",
            )}
          </li>
          <li>
            •{" "}
            <strong>
              {t("circuitBreaker.errorRateThreshold", "Umbral de tasa de error")}
            </strong>
            :{" "}
            {t(
              "circuitBreaker.instructions.errorRate",
              "Cuando la tasa de error supera este valor, el circuit breaker se abre",
            )}
          </li>
          <li>
            • <strong>{t("circuitBreaker.minRequests", "Solicitudes mínimas")}</strong>:{" "}
            {t(
              "circuitBreaker.instructions.minRequests",
              "Solo después de que el número de solicitudes alcanza este valor se calcula la tasa de error",
            )}
          </li>
        </ul>
      </div>
    </div>
  );
}
