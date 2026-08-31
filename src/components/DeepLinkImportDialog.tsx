import { useState, useEffect, useMemo } from "react";
import { listen } from "@tauri-apps/api/event";
import { DeepLinkImportRequest, deeplinkApi } from "@/lib/api/deeplink";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { PromptConfirmation } from "./deeplink/PromptConfirmation";
import { McpConfirmation } from "./deeplink/McpConfirmation";
import { SkillConfirmation } from "./deeplink/SkillConfirmation";
import { ProviderIcon } from "./ProviderIcon";

interface DeeplinkError {
  url: string;
  error: string;
}

export function DeepLinkImportDialog() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [request, setRequest] = useState<DeepLinkImportRequest | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  // Verificación de tolerancia a errores: el resultado de importación MCP puede no tener el campo type
  const isMcpImportResult = (
    value: unknown,
  ): value is {
    importedCount: number;
    importedIds: string[];
    failed: Array<{ id: string; error: string }>;
    type?: "mcp";
  } => {
    if (!value || typeof value !== "object") return false;
    const v = value as Record<string, unknown>;
    return (
      typeof v.importedCount === "number" &&
      Array.isArray(v.importedIds) &&
      Array.isArray(v.failed)
    );
  };

  useEffect(() => {
    // Escuchar eventos de importación por deep link
    const unlistenImport = listen<DeepLinkImportRequest>(
      "deeplink-import",
      async (event) => {
        // Si hay config presente, fusionarla para obtener la configuración completa
        if (event.payload.config || event.payload.configUrl) {
          try {
            const mergedRequest = await deeplinkApi.mergeDeeplinkConfig(
              event.payload,
            );
            setRequest(mergedRequest);
          } catch (error) {
            console.error("Failed to merge config:", error);
            toast.error(t("deeplink.configMergeError"), {
              description:
                error instanceof Error ? error.message : String(error),
            });
            // Volver a la solicitud original
            setRequest(event.payload);
          }
        } else {
          setRequest(event.payload);
        }

        setIsOpen(true);
      },
    );

    // Escuchar eventos de error por deep link
    const unlistenError = listen<DeeplinkError>("deeplink-error", (event) => {
      console.error("Deep link error:", event.payload);
      toast.error(t("deeplink.parseError"), {
        description: event.payload.error,
      });
    });

    return () => {
      unlistenImport.then((fn) => fn());
      unlistenError.then((fn) => fn());
    };
  }, [t]);

  const handleImport = async () => {
    if (!request) return;

    setIsImporting(true);

    try {
      const result = await deeplinkApi.importFromDeeplink(request);
      const refreshMcp = async (summary: {
        importedCount: number;
        importedIds: string[];
        failed: Array<{ id: string; error: string }>;
      }) => {
        // Forzar actualización de cachés relacionados con MCP, asegurar que la página de gestión recargue desde la base de datos
        await queryClient.invalidateQueries({
          queryKey: ["mcp", "all"],
          refetchType: "all",
        });
        await queryClient.refetchQueries({
          queryKey: ["mcp", "all"],
          type: "all",
        });

        if (summary.failed.length > 0) {
          toast.warning(t("deeplink.mcpPartialSuccess"), {
            description: t("deeplink.mcpPartialSuccessDescription", {
              success: summary.importedCount,
              failed: summary.failed.length,
            }),
          });
        } else {
          toast.success(t("deeplink.mcpImportSuccess"), {
            description: t("deeplink.mcpImportSuccessDescription", {
              count: summary.importedCount,
            }),
            closeButton: true,
          });
        }
      };

      // Manejar diferentes tipos de resultados
      if ("type" in result) {
        if (result.type === "provider") {
          await queryClient.invalidateQueries({
            queryKey: ["providers", request.app],
          });
          toast.success(t("deeplink.importSuccess"), {
            description: t("deeplink.importSuccessDescription", {
              name: request.name,
            }),
            closeButton: true,
          });
        } else if (result.type === "prompt") {
          // Los prompts no usan React Query, disparar evento personalizado para actualizar
          window.dispatchEvent(
            new CustomEvent("prompt-imported", {
              detail: { app: request.app },
            }),
          );
          toast.success(t("deeplink.promptImportSuccess"), {
            description: t("deeplink.promptImportSuccessDescription", {
              name: request.name,
            }),
            closeButton: true,
          });
        } else if (result.type === "mcp") {
          await refreshMcp(result);
        } else if (result.type === "skill") {
          // Actualizar Skills con estrategia agresiva
          queryClient.invalidateQueries({
            queryKey: ["skills"],
            refetchType: "all",
          });
          await queryClient.refetchQueries({
            queryKey: ["skills"],
            type: "all",
          });
          toast.success(t("deeplink.skillImportSuccess"), {
            description: t("deeplink.skillImportSuccessDescription", {
              repo: request.repo,
            }),
            closeButton: true,
          });
        }
      } else if (isMcpImportResult(result)) {
        // Manejo de respaldo: versiones antiguas del backend pueden no devolver el campo type
        await refreshMcp(result);
      } else {
        // Tipo de retorno heredado (ID string) - asumir proveedor
        await queryClient.invalidateQueries({
          queryKey: ["providers", request.app],
        });
        toast.success(t("deeplink.importSuccess"), {
          description: t("deeplink.importSuccessDescription", {
            name: request.name,
          }),
          closeButton: true,
        });
      }

      // Cerrar diálogo después de que todas las actualizaciones se completen
      setIsOpen(false);
    } catch (error) {
      console.error("Failed to import from deep link:", error);
      toast.error(t("deeplink.importError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleCancel = () => {
    setIsOpen(false);
  };

  // Enmascarar API key para mostrar (mostrar primeros 4 caracteres + ***)
  const maskedApiKey =
    request?.apiKey && request.apiKey.length > 4
      ? `${request.apiKey.substring(0, 4)}${"*".repeat(20)}`
      : "****";

  // Verificar si el archivo de configuración está presente
  const hasConfigFile = !!(request?.config || request?.configUrl);
  const configSource = request?.config
    ? "base64"
    : request?.configUrl
      ? "url"
      : null;

  // Analizar contenido del archivo de configuración para mostrar
  interface ParsedConfig {
    type: "claude" | "codex" | "gemini";
    env?: Record<string, string>;
    auth?: Record<string, string>;
    tomlConfig?: string;
    raw: Record<string, unknown>;
  }

  // Helper para decodificar base64 con soporte UTF-8
  const b64ToUtf8 = (str: string): string => {
    try {
      const binString = atob(str);
      const bytes = Uint8Array.from(binString, (m) => m.codePointAt(0) || 0);
      return new TextDecoder().decode(bytes);
    } catch (e) {
      console.error("Failed to decode base64:", e);
      return atob(str);
    }
  };

  const parsedConfig = useMemo((): ParsedConfig | null => {
    if (!request?.config) return null;
    try {
      const decoded = b64ToUtf8(request.config);
      const parsed = JSON.parse(decoded) as Record<string, unknown>;

      if (request.app === "claude") {
        // Formato Claude: { env: { ANTHROPIC_AUTH_TOKEN: ..., ... } }
        return {
          type: "claude",
          env: (parsed.env as Record<string, string>) || {},
          raw: parsed,
        };
      } else if (request.app === "codex") {
        // Formato Codex: { auth: { OPENAI_API_KEY: ... }, config: "TOML string" }
        return {
          type: "codex",
          auth: (parsed.auth as Record<string, string>) || {},
          tomlConfig: (parsed.config as string) || "",
          raw: parsed,
        };
      } else if (request.app === "gemini") {
        // Formato Gemini: estructura plana { GEMINI_API_KEY: ..., GEMINI_BASE_URL: ... }
        return {
          type: "gemini",
          env: parsed as Record<string, string>,
          raw: parsed,
        };
      }
      return null;
    } catch (e) {
      console.error("Failed to parse config:", e);
      return null;
    }
  }, [request?.config, request?.app]);

  // Helper para enmascarar valores sensibles
  const maskValue = (key: string, value: string): string => {
    const sensitiveKeys = ["TOKEN", "KEY", "SECRET", "PASSWORD"];
    const isSensitive = sensitiveKeys.some((k) =>
      key.toUpperCase().includes(k),
    );
    if (isSensitive && value.length > 8) {
      return `${value.substring(0, 8)}${"*".repeat(12)}`;
    }
    return value;
  };

  const getTitle = () => {
    if (!request) return t("deeplink.confirmImport");
    switch (request.resource) {
      case "prompt":
        return t("deeplink.importPrompt");
      case "mcp":
        return t("deeplink.importMcp");
      case "skill":
        return t("deeplink.importSkill");
      default:
        return t("deeplink.confirmImport");
    }
  };

  const getDescription = () => {
    if (!request) return t("deeplink.confirmImportDescription");
    switch (request.resource) {
      case "prompt":
        return t("deeplink.importPromptDescription");
      case "mcp":
        return t("deeplink.importMcpDescription");
      case "skill":
        return t("deeplink.importSkillDescription");
      default:
        return t("deeplink.confirmImportDescription");
    }
  };

  return (
    <Dialog open={isOpen && !!request} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-[500px]" zIndex="top">
        {request && (
          <>
            {/* Alinear título explícitamente a la izquierda, evitar que el estilo predeterminado centrado afecte */}
            <DialogHeader className="text-left sm:text-left">
              <DialogTitle>{getTitle()}</DialogTitle>
              <DialogDescription>{getDescription()}</DialogDescription>
            </DialogHeader>

            {/* Desplazar el contenido del cuerpo hacia la derecha, ligeramente más que el padding interno del título, para que el contenido no quede pegado al borde */}
            <div className="space-y-4 px-8 py-4 max-h-[60vh] overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:block [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-200 dark:[&::-webkit-scrollbar-thumb]:bg-gray-700">
              {request.resource === "prompt" && (
                <PromptConfirmation request={request} />
              )}
              {request.resource === "mcp" && (
                <McpConfirmation request={request} />
              )}
              {request.resource === "skill" && (
                <SkillConfirmation request={request} />
              )}

              {/* Vista de Proveedor Heredada */}
              {(request.resource === "provider" || !request.resource) && (
                <>
                  {/* Ícono del Proveedor - ampliar y centrar cerca de la parte superior */}
                  {request.icon && (
                    <div className="flex justify-center pt-2 pb-1">
                      <ProviderIcon
                        icon={request.icon}
                        name={request.name || request.icon}
                        size={80}
                        className="drop-shadow-sm"
                      />
                    </div>
                  )}

                  {/* Tipo de App */}
                  <div className="grid grid-cols-3 items-center gap-4">
                    <div className="font-medium text-sm text-muted-foreground">
                      {t("deeplink.app")}
                    </div>
                    <div className="col-span-2 text-sm font-medium capitalize">
                      {request.app}
                    </div>
                  </div>

                  {/* Nombre del Proveedor */}
                  <div className="grid grid-cols-3 items-center gap-4">
                    <div className="font-medium text-sm text-muted-foreground">
                      {t("deeplink.providerName")}
                    </div>
                    <div className="col-span-2 text-sm font-medium">
                      {request.name}
                    </div>
                  </div>

                  {/* Página de inicio */}
                  <div className="grid grid-cols-3 items-center gap-4">
                    <div className="font-medium text-sm text-muted-foreground">
                      {t("deeplink.homepage")}
                    </div>
                    <div className="col-span-2 text-sm break-all text-blue-600 dark:text-blue-400">
                      {request.homepage}
                    </div>
                  </div>

                  {/* Endpoint de API */}
                  <div className="grid grid-cols-3 items-start gap-4">
                    <div className="font-medium text-sm text-muted-foreground pt-0.5">
                      {t("deeplink.endpoint")}
                    </div>
                    <div className="col-span-2 text-sm break-all space-y-1">
                      {request.endpoint?.split(",").map((ep, idx) => (
                        <div
                          key={idx}
                          className={
                            idx === 0 ? "font-medium" : "text-muted-foreground"
                          }
                        >
                          {idx === 0 ? "🔹 " : "└ "}
                          {ep.trim()}
                          {idx === 0 && request.endpoint?.includes(",") && (
                            <span className="text-xs text-muted-foreground ml-2">
                              ({t("deeplink.primaryEndpoint")})
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* API Key (enmascarada) */}
                  <div className="grid grid-cols-3 items-center gap-4">
                    <div className="font-medium text-sm text-muted-foreground">
                      {t("deeplink.apiKey")}
                    </div>
                    <div className="col-span-2 text-sm font-mono text-muted-foreground">
                      {maskedApiKey}
                    </div>
                  </div>

                  {/* Campos de Modelo - mostrar diferentes campos de modelo según el tipo de aplicación */}
                  {request.app === "claude" ? (
                    <>
                      {/* Cuatro campos de modelo de Claude */}
                      {request.haikuModel && (
                        <div className="grid grid-cols-3 items-center gap-4">
                          <div className="font-medium text-sm text-muted-foreground">
                            {t("deeplink.haikuModel")}
                          </div>
                          <div className="col-span-2 text-sm font-mono">
                            {request.haikuModel}
                          </div>
                        </div>
                      )}
                      {request.sonnetModel && (
                        <div className="grid grid-cols-3 items-center gap-4">
                          <div className="font-medium text-sm text-muted-foreground">
                            {t("deeplink.sonnetModel")}
                          </div>
                          <div className="col-span-2 text-sm font-mono">
                            {request.sonnetModel}
                          </div>
                        </div>
                      )}
                      {request.opusModel && (
                        <div className="grid grid-cols-3 items-center gap-4">
                          <div className="font-medium text-sm text-muted-foreground">
                            {t("deeplink.opusModel")}
                          </div>
                          <div className="col-span-2 text-sm font-mono">
                            {request.opusModel}
                          </div>
                        </div>
                      )}
                      {request.model && (
                        <div className="grid grid-cols-3 items-center gap-4">
                          <div className="font-medium text-sm text-muted-foreground">
                            {t("deeplink.multiModel")}
                          </div>
                          <div className="col-span-2 text-sm font-mono">
                            {request.model}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      {/* Codex y Gemini usan campo model genérico */}
                      {request.model && (
                        <div className="grid grid-cols-3 items-center gap-4">
                          <div className="font-medium text-sm text-muted-foreground">
                            {t("deeplink.model")}
                          </div>
                          <div className="col-span-2 text-sm font-mono">
                            {request.model}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* Notas (si están presentes) */}
                  {request.notes && (
                    <div className="grid grid-cols-3 items-start gap-4">
                      <div className="font-medium text-sm text-muted-foreground">
                        {t("deeplink.notes")}
                      </div>
                      <div className="col-span-2 text-sm text-muted-foreground">
                        {request.notes}
                      </div>
                    </div>
                  )}

                  {/* Detalles del Archivo de Configuración (v3.8+) */}
                  {hasConfigFile && (
                    <div className="space-y-3 pt-2 border-t border-border-default">
                      <div className="grid grid-cols-3 items-center gap-4">
                        <div className="font-medium text-sm text-muted-foreground">
                          {t("deeplink.configSource")}
                        </div>
                        <div className="col-span-2 text-sm">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-medium">
                            {configSource === "base64"
                              ? t("deeplink.configEmbedded")
                              : t("deeplink.configRemote")}
                          </span>
                          {request.configFormat && (
                            <span className="ml-2 text-xs text-muted-foreground uppercase">
                              {request.configFormat}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Parsed Config Details */}
                      {parsedConfig && (
                        <div className="rounded-lg bg-muted/50 p-3 space-y-2">
                          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            {t("deeplink.configDetails")}
                          </div>

                          {/* Configuración de Claude */}
                          {parsedConfig.type === "claude" &&
                            parsedConfig.env && (
                              <div className="space-y-1.5">
                                {Object.entries(parsedConfig.env).map(
                                  ([key, value]) => (
                                    <div
                                      key={key}
                                      className="grid grid-cols-2 gap-2 text-xs"
                                    >
                                      <span className="font-mono text-muted-foreground truncate">
                                        {key}
                                      </span>
                                      <span className="font-mono truncate">
                                        {maskValue(key, String(value))}
                                      </span>
                                    </div>
                                  ),
                                )}
                              </div>
                            )}

                          {/* Configuración de Codex */}
                          {parsedConfig.type === "codex" && (
                            <div className="space-y-2">
                              {parsedConfig.auth &&
                                Object.keys(parsedConfig.auth).length > 0 && (
                                  <div className="space-y-1.5">
                                    <div className="text-xs text-muted-foreground">
                                      Auth:
                                    </div>
                                    {Object.entries(parsedConfig.auth).map(
                                      ([key, value]) => (
                                        <div
                                          key={key}
                                          className="grid grid-cols-2 gap-2 text-xs pl-2"
                                        >
                                          <span className="font-mono text-muted-foreground truncate">
                                            {key}
                                          </span>
                                          <span className="font-mono truncate">
                                            {maskValue(key, String(value))}
                                          </span>
                                        </div>
                                      ),
                                    )}
                                  </div>
                                )}
                              {parsedConfig.tomlConfig && (
                                <div className="space-y-1">
                                  <div className="text-xs text-muted-foreground">
                                    TOML Config:
                                  </div>
                                  <pre className="text-xs font-mono bg-background p-2 rounded overflow-x-auto max-h-24 whitespace-pre-wrap">
                                    {parsedConfig.tomlConfig.substring(0, 300)}
                                    {parsedConfig.tomlConfig.length > 300 &&
                                      "..."}
                                  </pre>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Configuración de Gemini */}
                          {parsedConfig.type === "gemini" &&
                            parsedConfig.env && (
                              <div className="space-y-1.5">
                                {Object.entries(parsedConfig.env).map(
                                  ([key, value]) => (
                                    <div
                                      key={key}
                                      className="grid grid-cols-2 gap-2 text-xs"
                                    >
                                      <span className="font-mono text-muted-foreground truncate">
                                        {key}
                                      </span>
                                      <span className="font-mono truncate">
                                        {maskValue(key, String(value))}
                                      </span>
                                    </div>
                                  ),
                                )}
                              </div>
                            )}
                        </div>
                      )}

                      {/* Config URL (si es remota) */}
                      {request.configUrl && (
                        <div className="grid grid-cols-3 items-center gap-4">
                          <div className="font-medium text-sm text-muted-foreground">
                            {t("deeplink.configUrl")}
                          </div>
                          <div className="col-span-2 text-sm font-mono text-muted-foreground break-all">
                            {request.configUrl}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Configuración de Script de Uso (v3.9+) */}
                  {request.usageScript && (
                    <div className="space-y-3 pt-2 border-t border-border-default">
                      <div className="grid grid-cols-3 items-center gap-4">
                        <div className="font-medium text-sm text-muted-foreground">
                          {t("deeplink.usageScript", {
                            defaultValue: "Consulta de uso",
                          })}
                        </div>
                        <div className="col-span-2 text-sm">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${
                              request.usageEnabled !== false
                                ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                                : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                            }`}
                          >
                            {request.usageEnabled !== false
                              ? t("deeplink.usageScriptEnabled", {
                                  defaultValue: "Habilitado",
                                })
                              : t("deeplink.usageScriptDisabled", {
                                  defaultValue: "No habilitado",
                                })}
                          </span>
                        </div>
                      </div>

                      {/* API Key de Uso (si es diferente del proveedor) */}
                      {request.usageApiKey &&
                        request.usageApiKey !== request.apiKey && (
                          <div className="grid grid-cols-3 items-center gap-4">
                            <div className="font-medium text-sm text-muted-foreground">
                              {t("deeplink.usageApiKey", {
                                defaultValue: "API Key de Uso",
                              })}
                            </div>
                            <div className="col-span-2 text-sm font-mono text-muted-foreground">
                              {request.usageApiKey.length > 4
                                ? `${request.usageApiKey.substring(0, 4)}${"*".repeat(12)}`
                                : "****"}
                            </div>
                          </div>
                        )}

                      {/* URL Base de Uso (si es diferente del proveedor) */}
                      {request.usageBaseUrl &&
                        request.usageBaseUrl !== request.endpoint && (
                          <div className="grid grid-cols-3 items-center gap-4">
                            <div className="font-medium text-sm text-muted-foreground">
                              {t("deeplink.usageBaseUrl", {
                                defaultValue: "Dirección de consulta de uso",
                              })}
                            </div>
                            <div className="col-span-2 text-sm break-all">
                              {request.usageBaseUrl}
                            </div>
                          </div>
                        )}

                      {/* Intervalo de Consulta Automática */}
                      {request.usageAutoInterval &&
                        request.usageAutoInterval > 0 && (
                          <div className="grid grid-cols-3 items-center gap-4">
                            <div className="font-medium text-sm text-muted-foreground">
                              {t("deeplink.usageAutoInterval", {
                                defaultValue: "Consulta automática",
                              })}
                            </div>
                            <div className="col-span-2 text-sm">
                              {t("deeplink.usageAutoIntervalValue", {
                                defaultValue: "Cada {{minutes}} minutos",
                                minutes: request.usageAutoInterval,
                              })}
                            </div>
                          </div>
                        )}
                    </div>
                  )}

                  {/* Advertencia */}
                  <div className="rounded-lg bg-yellow-50 dark:bg-yellow-900/20 p-3 text-sm text-yellow-800 dark:text-yellow-200">
                    {t("deeplink.warning")}
                  </div>
                </>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={handleCancel}
                disabled={isImporting}
              >
                {t("common.cancel")}
              </Button>
              <Button onClick={handleImport} disabled={isImporting}>
                {isImporting ? t("deeplink.importing") : t("deeplink.import")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
