/**
 * Hook de gestión de estado del servicio proxy
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type {
  ProxyStatus,
  ProxyServerInfo,
  ProxyTakeoverStatus,
} from "@/types/proxy";
import { extractErrorMessage } from "@/utils/errorUtils";

/**
 * Gestión de estado del servicio proxy
 */
export function useProxyStatus() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  // Consultar estado (polling automático)
  const { data: status, isLoading } = useQuery({
    queryKey: ["proxyStatus"],
    queryFn: () => invoke<ProxyStatus>("get_proxy_status"),
    // Solo hacer polling cuando el servicio está en ejecución
    refetchInterval: (query) => (query.state.data?.running ? 2000 : false),
    // Mantener datos previos, evitar parpadeo
    placeholderData: (previousData) => previousData,
  });

  // Consultar estado de takeover de cada aplicación
  const { data: takeoverStatus } = useQuery({
    queryKey: ["proxyTakeoverStatus"],
    queryFn: () => invoke<ProxyTakeoverStatus>("get_proxy_takeover_status"),
    placeholderData: (previousData) => previousData,
  });

  // Iniciar servidor (interruptor general: solo iniciar servicio, no tomar control)
  const startProxyServerMutation = useMutation({
    mutationFn: () => invoke<ProxyServerInfo>("start_proxy_server"),
    onSuccess: (info) => {
      toast.success(
        t("proxy.server.started", {
          address: info.address,
          port: info.port,
          defaultValue: `Servicio proxy iniciado - ${info.address}:${info.port}`,
        }),
        { closeButton: true },
      );
      queryClient.invalidateQueries({ queryKey: ["proxyStatus"] });
    },
    onError: (error: Error) => {
      const detail =
        extractErrorMessage(error) ||
        t("common.unknown", { defaultValue: "Error desconocido" });
      toast.error(
        t("proxy.server.startFailed", {
          detail,
          defaultValue: `Error al iniciar servicio proxy: ${detail}`,
        }),
      );
    },
  });

  // Detener servidor (solo detener servicio, no modificar/restaurar estado de takeover de otras aplicaciones)
  const stopProxyServerMutation = useMutation({
    mutationFn: () => invoke("stop_proxy_server"),
    onSuccess: () => {
      toast.success(
        t("proxy.server.stopped", {
          defaultValue: "Servicio proxy detenido",
        }),
        { closeButton: true },
      );
      queryClient.invalidateQueries({ queryKey: ["proxyStatus"] });
    },
    onError: (error: Error) => {
      const detail =
        extractErrorMessage(error) ||
        t("common.unknown", { defaultValue: "Error desconocido" });
      toast.error(
        t("proxy.server.stopFailed", {
          detail,
          defaultValue: `Error al detener servicio proxy: ${detail}`,
        }),
      );
    },
  });

  // Detener servidor (cerrar interruptor general: forzar restauración de todas las configuraciones Live tomadas)
  const stopWithRestoreMutation = useMutation({
    mutationFn: () => invoke("stop_proxy_with_restore"),
    onSuccess: () => {
      toast.success(
        t("proxy.stoppedWithRestore", {
          defaultValue: "Servicio proxy cerrado, todas las configuraciones de takeover han sido restauradas",
        }),
        { closeButton: true },
      );
      queryClient.invalidateQueries({ queryKey: ["proxyStatus"] });
      queryClient.invalidateQueries({ queryKey: ["proxyTakeoverStatus"] });
      // Eliminar completamente todo el caché de estado de salud del proveedor (backend ya limpió registros de base de datos)
      queryClient.removeQueries({ queryKey: ["providerHealth"] });
      // Eliminar completamente todo el caché de estadísticas del circuit breaker (estado del circuit breaker se reinició después de detener proxy)
      queryClient.removeQueries({ queryKey: ["circuitBreakerStats"] });
      // Nota: la cola de failover y el estado del interruptor se conservarán, no necesita actualización
    },
    onError: (error: Error) => {
      const detail =
        extractErrorMessage(error) ||
        t("common.unknown", { defaultValue: "Error desconocido" });
      toast.error(
        t("proxy.stopWithRestoreFailed", {
          detail,
          defaultValue: `Error al detener: ${detail}`,
        }),
      );
    },
  });

  // Activar/desactivar takeover por aplicación
  const setTakeoverForAppMutation = useMutation({
    mutationFn: ({ appType, enabled }: { appType: string; enabled: boolean }) =>
      invoke("set_proxy_takeover_for_app", { appType, enabled }),
    onSuccess: (_data, variables) => {
      const appLabel =
        variables.appType === "claude"
          ? "Claude"
          : variables.appType === "codex"
            ? "Codex"
            : variables.appType === "gemini"
              ? "Gemini"
              : "OpenCode";

      toast.success(
        variables.enabled
          ? t("proxy.takeover.enabled", {
              app: appLabel,
              defaultValue: `Configuración de ${appLabel} tomada (las solicitudes pasarán por proxy local)`,
            })
          : t("proxy.takeover.disabled", {
              app: appLabel,
              defaultValue: `Configuración de ${appLabel} restaurada`,
            }),
        { closeButton: true },
      );

      queryClient.invalidateQueries({ queryKey: ["proxyStatus"] });
      queryClient.invalidateQueries({ queryKey: ["proxyTakeoverStatus"] });
    },
    onError: (error: Error) => {
      const detail =
        extractErrorMessage(error) ||
        t("common.unknown", { defaultValue: "Error desconocido" });
      toast.error(
        t("proxy.takeover.failed", {
          detail,
          defaultValue: `Error en operación: ${detail}`,
        }),
      );
    },
  });

  // Cambiar proveedor en modo proxy (hot switch)
  const switchProxyProviderMutation = useMutation({
    mutationFn: ({
      appType,
      providerId,
    }: {
      appType: string;
      providerId: string;
    }) => invoke("switch_proxy_provider", { appType, providerId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["proxyStatus"] });
    },
    onError: (error: Error) => {
      const detail =
        extractErrorMessage(error) ||
        t("common.unknown", { defaultValue: "Error desconocido" });
      toast.error(
        t("proxy.switchFailed", {
          error: detail,
          defaultValue: `Error al cambiar: ${detail}`,
        }),
      );
    },
  });

  // Verificar si está en ejecución
  const checkRunning = async () => {
    try {
      return await invoke<boolean>("is_proxy_running");
    } catch {
      return false;
    }
  };

  // Verificar estado de takeover
  const checkTakeoverActive = async () => {
    try {
      return await invoke<boolean>("is_live_takeover_active");
    } catch {
      return false;
    }
  };

  return {
    status,
    isLoading,
    isRunning: status?.running || false,
    takeoverStatus,
    isTakeoverActive:
      takeoverStatus?.claude ||
      takeoverStatus?.codex ||
      takeoverStatus?.gemini ||
      false,

    // 启动/停止（总开关）
    startProxyServer: startProxyServerMutation.mutateAsync,
    stopProxyServer: stopProxyServerMutation.mutateAsync,
    stopWithRestore: stopWithRestoreMutation.mutateAsync,

    // 按应用接管开关
    setTakeoverForApp: setTakeoverForAppMutation.mutateAsync,

    // 代理模式下切换供应商
    switchProxyProvider: switchProxyProviderMutation.mutateAsync,

    // 状态检查
    checkRunning,
    checkTakeoverActive,

    // 加载状态
    isStarting: startProxyServerMutation.isPending,
    isStoppingServer: stopProxyServerMutation.isPending,
    isStopping: stopWithRestoreMutation.isPending,
    isPending:
      startProxyServerMutation.isPending ||
      stopProxyServerMutation.isPending ||
      stopWithRestoreMutation.isPending ||
      setTakeoverForAppMutation.isPending,
  };
}
