import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { providersApi, settingsApi } from "@/lib/api";
import { syncCurrentProvidersLiveSafe } from "@/utils/postChangeSync";
import { useSettingsQuery, useSaveSettingsMutation } from "@/lib/query";
import type { Settings } from "@/types";
import { useSettingsForm, type SettingsFormState } from "./useSettingsForm";
import {
  useDirectorySettings,
  type DirectoryAppId,
  type ResolvedDirectories,
} from "./useDirectorySettings";
import { useSettingsMetadata } from "./useSettingsMetadata";

interface SaveResult {
  requiresRestart: boolean;
}

export interface UseSettingsResult {
  settings: SettingsFormState | null;
  isLoading: boolean;
  isSaving: boolean;
  isPortable: boolean;
  appConfigDir?: string;
  resolvedDirs: ResolvedDirectories;
  requiresRestart: boolean;
  updateSettings: (updates: Partial<SettingsFormState>) => void;
  updateDirectory: (app: DirectoryAppId, value?: string) => void;
  updateAppConfigDir: (value?: string) => void;
  browseDirectory: (app: DirectoryAppId) => Promise<void>;
  browseAppConfigDir: () => Promise<void>;
  resetDirectory: (app: DirectoryAppId) => Promise<void>;
  resetAppConfigDir: () => Promise<void>;
  saveSettings: (
    overrides?: Partial<SettingsFormState>,
    options?: { silent?: boolean },
  ) => Promise<SaveResult | null>;
  autoSaveSettings: (
    updates: Partial<SettingsFormState>,
  ) => Promise<SaveResult | null>;
  resetSettings: () => void;
  acknowledgeRestart: () => void;
}

export type { SettingsFormState, ResolvedDirectories };

const sanitizeDir = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/**
 * useSettings - Capa de composición
 * Responsable de:
 * - Componer useSettingsForm, useDirectorySettings, useSettingsMetadata
 * - Lógica de guardar configuración
 * - Lógica de resetear configuración
 */
export function useSettings(): UseSettingsResult {
  const { t } = useTranslation();
  const { data } = useSettingsQuery();
  const saveMutation = useSaveSettingsMutation();
  const queryClient = useQueryClient();

  // 1️⃣ Gestión de estado del formulario
  const {
    settings,
    isLoading: isFormLoading,
    initialLanguage,
    updateSettings,
    resetSettings: resetForm,
    syncLanguage,
  } = useSettingsForm();

  // 2️⃣ Gestión de directorios
  const {
    appConfigDir,
    resolvedDirs,
    isLoading: isDirectoryLoading,
    initialAppConfigDir,
    updateDirectory,
    updateAppConfigDir,
    browseDirectory,
    browseAppConfigDir,
    resetDirectory,
    resetAppConfigDir,
    resetAllDirectories,
  } = useDirectorySettings({
    settings,
    onUpdateSettings: updateSettings,
  });

  // 3️⃣ Gestión de metadatos
  const {
    isPortable,
    requiresRestart,
    isLoading: isMetadataLoading,
    acknowledgeRestart,
    setRequiresRestart,
  } = useSettingsMetadata();

  // Resetear configuración
  const resetSettings = useCallback(() => {
    resetForm(data ?? null);
    syncLanguage(initialLanguage);
    resetAllDirectories({
      claude: sanitizeDir(data?.claudeConfigDir),
      codex: sanitizeDir(data?.codexConfigDir),
      gemini: sanitizeDir(data?.geminiConfigDir),
      opencode: sanitizeDir(data?.opencodeConfigDir),
      openclaw: sanitizeDir(data?.openclawConfigDir),
      hermes: sanitizeDir(data?.hermesConfigDir),
    });
    setRequiresRestart(false);
  }, [
    data,
    initialLanguage,
    resetForm,
    syncLanguage,
    resetAllDirectories,
    setRequiresRestart,
  ]);

  // Sincronizar configuración de integración del plugin Claude a ~/.claude/settings.json
  // Retorna true indica que se ejecutó syncCurrentProvidersLiveSafe, el caller puede omitir sincronización duplicada
  // prevEnabled debe ser capturado por el caller desde el caché en vivo (queryClient.getQueryData) antes de saveMutation,
  // para evitar race de conmutación rápida causado por data retrasado en el closure useCallback que no se ha re-renderizado.
  const syncClaudePluginIfChanged = useCallback(
    async (
      enabled: boolean | undefined,
      prevEnabled: boolean | undefined,
    ): Promise<boolean> => {
      if (enabled === undefined || enabled === prevEnabled) return false;
      try {
        if (enabled) {
          const currentId = await providersApi.getCurrent("claude");
          let isOfficial = false;
          if (currentId) {
            const allProviders = await providersApi.getAll("claude");
            isOfficial = allProviders[currentId]?.category === "official";
          }
          await settingsApi.applyClaudePluginConfig({ official: isOfficial });
        } else {
          await settingsApi.applyClaudePluginConfig({ official: true });
        }

        const syncResult = await syncCurrentProvidersLiveSafe();
        if (!syncResult.ok) {
          console.warn(
            "[useSettings] Failed to sync providers after toggling Claude plugin",
            syncResult.error,
          );
          toast.error(
            t("notifications.syncClaudePluginFailed", {
              defaultValue: "Error al sincronizar plugin Claude",
            }),
          );
        }
        return true;
      } catch (error) {
        console.warn(
          "[useSettings] Failed to sync Claude plugin config",
          error,
        );
        toast.error(
          t("notifications.syncClaudePluginFailed", {
            defaultValue: "Error al sincronizar plugin Claude",
          }),
        );
        return false;
      }
    },
    [t],
  );

  // Guardar configuración inmediata (para actualizaciones en tiempo real de la pestaña General)
  // Guardar configuración básica + llamadas API del sistema independientes (inicio automático)
  const autoSaveSettings = useCallback(
    async (updates: Partial<SettingsFormState>): Promise<SaveResult | null> => {
      const mergedSettings = settings ? { ...settings, ...updates } : null;
      if (!mergedSettings) return null;

      try {
        const sanitizedClaudeDir = sanitizeDir(mergedSettings.claudeConfigDir);
        const sanitizedCodexDir = sanitizeDir(mergedSettings.codexConfigDir);
        const sanitizedGeminiDir = sanitizeDir(mergedSettings.geminiConfigDir);
        const sanitizedOpencodeDir = sanitizeDir(
          mergedSettings.opencodeConfigDir,
        );
        const sanitizedOpenclawDir = sanitizeDir(
          mergedSettings.openclawConfigDir,
        );
        const { webdavSync: _ignoredWebdavSync, ...restSettings } =
          mergedSettings;

        const payload: Settings = {
          ...restSettings,
          claudeConfigDir: sanitizedClaudeDir,
          codexConfigDir: sanitizedCodexDir,
          geminiConfigDir: sanitizedGeminiDir,
          opencodeConfigDir: sanitizedOpencodeDir,
          openclawConfigDir: sanitizedOpenclawDir,
          language: mergedSettings.language,
        };

        // Capturar el estado de integración del plugin persistido previamente desde el caché en vivo antes de mutate,
        // evitar que data en el closure se retrase porque React aún no ha re-renderizado
        const prevPluginEnabled = queryClient.getQueryData<Settings>([
          "settings",
        ])?.enableClaudePluginIntegration;

        // Guardar en archivo de configuración
        await saveMutation.mutateAsync(payload);

        // Si cambió el estado de inicio automático, llamar API del sistema
        if (
          payload.launchOnStartup !== undefined &&
          payload.launchOnStartup !== data?.launchOnStartup
        ) {
          try {
            await settingsApi.setAutoLaunch(payload.launchOnStartup);
          } catch (error) {
            console.error("Failed to update auto-launch:", error);
            toast.error(
              t("settings.autoLaunchFailed", {
                defaultValue: "Error al configurar inicio automático",
              }),
            );
          }
        }

        // Confirmación de primera instalación Claude Code: activado=escribir hasCompletedOnboarding=true; desactivado=eliminar ese campo
        // Solo se activa cuando esta actualización incluye skipClaudeOnboarding, evita activación errónea de otros guardados automáticos
        const nextSkipClaudeOnboarding = updates.skipClaudeOnboarding;
        if (
          nextSkipClaudeOnboarding !== undefined &&
          nextSkipClaudeOnboarding !== (data?.skipClaudeOnboarding ?? false)
        ) {
          try {
            if (nextSkipClaudeOnboarding) {
              await settingsApi.applyClaudeOnboardingSkip();
            } else {
              await settingsApi.clearClaudeOnboardingSkip();
            }
          } catch (error) {
            console.warn(
              "[useSettings] Failed to sync Claude onboarding skip",
              error,
            );
            toast.error(
              nextSkipClaudeOnboarding
                ? t("notifications.skipClaudeOnboardingFailed", {
                    defaultValue: "Error al omitir confirmación de primera instalación de Claude Code",
                  })
                : t("notifications.clearClaudeOnboardingSkipFailed", {
                    defaultValue: "Error al restaurar confirmación de primera instalación de Claude Code",
                  }),
            );
          }
        }

        await syncClaudePluginIfChanged(
          payload.enableClaudePluginIntegration,
          prevPluginEnabled,
        );

        // Persistir preferencia de idioma
        try {
          if (typeof window !== "undefined" && updates.language) {
            window.localStorage.setItem("language", updates.language);
          }
        } catch (error) {
          console.warn(
            "[useSettings] Failed to persist language preference",
            error,
          );
        }

        // Actualizar menú de bandeja
        try {
          await providersApi.updateTrayMenu();
        } catch (error) {
          console.warn("[useSettings] Failed to refresh tray menu", error);
        }

        return { requiresRestart: false };
      } catch (error) {
        console.error("[useSettings] Failed to auto-save settings", error);
        toast.error(
          t("notifications.settingsSaveFailed", {
            defaultValue: "Error al guardar configuración: {{error}}",
            error: (error as Error)?.message ?? String(error),
          }),
        );
        throw error;
      }
    },
    [data, queryClient, saveMutation, settings, syncClaudePluginIfChanged, t],
  );

  // Guardar configuración completa (para guardado manual en pestaña Advanced)
  // Incluye todas las llamadas API del sistema y proceso de validación completo
  const saveSettings = useCallback(
    async (
      overrides?: Partial<SettingsFormState>,
      options?: { silent?: boolean },
    ): Promise<SaveResult | null> => {
      const mergedSettings = settings ? { ...settings, ...overrides } : null;
      if (!mergedSettings) return null;
      try {
        const sanitizedAppDir = sanitizeDir(appConfigDir);
        const sanitizedClaudeDir = sanitizeDir(mergedSettings.claudeConfigDir);
        const sanitizedCodexDir = sanitizeDir(mergedSettings.codexConfigDir);
        const sanitizedGeminiDir = sanitizeDir(mergedSettings.geminiConfigDir);
        const sanitizedOpencodeDir = sanitizeDir(
          mergedSettings.opencodeConfigDir,
        );
        const sanitizedOpenclawDir = sanitizeDir(
          mergedSettings.openclawConfigDir,
        );
        const previousAppDir = initialAppConfigDir;
        const previousClaudeDir = sanitizeDir(data?.claudeConfigDir);
        const previousCodexDir = sanitizeDir(data?.codexConfigDir);
        const previousGeminiDir = sanitizeDir(data?.geminiConfigDir);
        const previousOpencodeDir = sanitizeDir(data?.opencodeConfigDir);
        const previousOpenclawDir = sanitizeDir(data?.openclawConfigDir);
        const { webdavSync: _ignoredWebdavSync, ...restSettings } =
          mergedSettings;

        const payload: Settings = {
          ...restSettings,
          claudeConfigDir: sanitizedClaudeDir,
          codexConfigDir: sanitizedCodexDir,
          geminiConfigDir: sanitizedGeminiDir,
          opencodeConfigDir: sanitizedOpencodeDir,
          openclawConfigDir: sanitizedOpenclawDir,
          language: mergedSettings.language,
        };

        // Capturar el estado de integración del plugin persistido previamente desde el caché en vivo antes de mutate,
        // evitar que data en el closure se retrase porque React aún no ha re-renderizado
        const prevPluginEnabled = queryClient.getQueryData<Settings>([
          "settings",
        ])?.enableClaudePluginIntegration;

        await saveMutation.mutateAsync(payload);

        await settingsApi.setAppConfigDirOverride(sanitizedAppDir ?? null);

        // Solo llamar API del sistema cuando el estado de inicio automático realmente cambió
        if (
          payload.launchOnStartup !== undefined &&
          payload.launchOnStartup !== data?.launchOnStartup
        ) {
          try {
            await settingsApi.setAutoLaunch(payload.launchOnStartup);
          } catch (error) {
            console.error("Failed to update auto-launch:", error);
            toast.error(
              t("settings.autoLaunchFailed", {
                defaultValue: "Error al configurar inicio automático",
              }),
            );
          }
        }

        // Confirmación de primera instalación Claude Code: activado=escribir hasCompletedOnboarding=true; desactivado=eliminar ese campo
        const prevSkipClaudeOnboarding = data?.skipClaudeOnboarding ?? false;
        const nextSkipClaudeOnboarding = payload.skipClaudeOnboarding ?? false;
        if (nextSkipClaudeOnboarding !== prevSkipClaudeOnboarding) {
          try {
            if (nextSkipClaudeOnboarding) {
              await settingsApi.applyClaudeOnboardingSkip();
            } else {
              await settingsApi.clearClaudeOnboardingSkip();
            }
          } catch (error) {
            console.warn(
              "[useSettings] Failed to sync Claude onboarding skip",
              error,
            );
            toast.error(
              nextSkipClaudeOnboarding
                ? t("notifications.skipClaudeOnboardingFailed", {
                    defaultValue: "Error al omitir confirmación de primera instalación de Claude Code",
                  })
                : t("notifications.clearClaudeOnboardingSkipFailed", {
                    defaultValue: "Error al restaurar confirmación de primera instalación de Claude Code",
                  }),
            );
          }
        }

        const pluginSynced = await syncClaudePluginIfChanged(
          payload.enableClaudePluginIntegration,
          prevPluginEnabled,
        );

        try {
          if (typeof window !== "undefined" && payload.language) {
            window.localStorage.setItem("language", payload.language);
          }
        } catch (error) {
          console.warn(
            "[useSettings] Failed to persist language preference",
            error,
          );
        }

        try {
          await providersApi.updateTrayMenu();
        } catch (error) {
          console.warn("[useSettings] Failed to refresh tray menu", error);
        }

        // Si la sobrescritura de directorios Claude/Codex/Gemini/OpenCode/OpenClaw cambió, escribir inmediatamente "proveedor en uso actual" de vuelta a la config live de la app correspondiente
        // Si la sincronización del plugin ya ejecutó syncCurrentProvidersLiveSafe, omitir para evitar duplicación
        const claudeDirChanged = sanitizedClaudeDir !== previousClaudeDir;
        const codexDirChanged = sanitizedCodexDir !== previousCodexDir;
        const geminiDirChanged = sanitizedGeminiDir !== previousGeminiDir;
        const opencodeDirChanged = sanitizedOpencodeDir !== previousOpencodeDir;
        const openclawDirChanged = sanitizedOpenclawDir !== previousOpenclawDir;
        if (
          !pluginSynced &&
          (claudeDirChanged ||
            codexDirChanged ||
            geminiDirChanged ||
            opencodeDirChanged ||
            openclawDirChanged)
        ) {
          const syncResult = await syncCurrentProvidersLiveSafe();
          if (!syncResult.ok) {
            console.warn(
              "[useSettings] Failed to sync current providers after directory change",
              syncResult.error,
            );
          }
        }

        const appDirChanged = sanitizedAppDir !== (previousAppDir ?? undefined);
        setRequiresRestart(appDirChanged);

        if (!options?.silent) {
          toast.success(
            t("notifications.settingsSaved", {
              defaultValue: "Configuración guardada",
            }),
            { closeButton: true },
          );
        }

        return { requiresRestart: appDirChanged };
      } catch (error) {
        console.error("[useSettings] Failed to save settings", error);
        toast.error(
          t("notifications.settingsSaveFailed", {
            defaultValue: "Error al guardar configuración: {{error}}",
            error: (error as Error)?.message ?? String(error),
          }),
        );
        throw error;
      }
    },
    [
      appConfigDir,
      data,
      initialAppConfigDir,
      queryClient,
      saveMutation,
      settings,
      setRequiresRestart,
      syncClaudePluginIfChanged,
      t,
    ],
  );

  const isLoading = useMemo(
    () => isFormLoading || isDirectoryLoading || isMetadataLoading,
    [isFormLoading, isDirectoryLoading, isMetadataLoading],
  );

  return {
    settings,
    isLoading,
    isSaving: saveMutation.isPending,
    isPortable,
    appConfigDir,
    resolvedDirs,
    requiresRestart,
    updateSettings,
    updateDirectory,
    updateAppConfigDir,
    browseDirectory,
    browseAppConfigDir,
    resetDirectory,
    resetAppConfigDir,
    saveSettings,
    autoSaveSettings,
    resetSettings,
    acknowledgeRestart,
  };
}
