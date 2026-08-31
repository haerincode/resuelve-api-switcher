import { z } from "zod";

const directorySchema = z
  .string()
  .trim()
  .min(1, "La ruta no puede estar vacía")
  .optional()
  .or(z.literal(""));

export const settingsSchema = z.object({
  // Configuración UI nivel dispositivo
  showInTray: z.boolean(),
  minimizeToTrayOnClose: z.boolean(),
  enableClaudePluginIntegration: z.boolean().optional(),
  skipClaudeOnboarding: z.boolean().optional(),
  launchOnStartup: z.boolean().optional(),
  enableLocalProxy: z.boolean().optional(),
  language: z.enum(["es", "en"]).optional(),

  // Sobrescritura de directorios nivel dispositivo
  claudeConfigDir: directorySchema.nullable().optional(),
  codexConfigDir: directorySchema.nullable().optional(),
  geminiConfigDir: directorySchema.nullable().optional(),
  opencodeConfigDir: directorySchema.nullable().optional(),
  openclawConfigDir: directorySchema.nullable().optional(),

  // ID del proveedor actual (nivel dispositivo)
  currentProviderClaude: z.string().optional(),
  currentProviderClaudeDesktop: z.string().optional(),
  currentProviderCodex: z.string().optional(),
  currentProviderGemini: z.string().optional(),

  // Configuración de sincronización Skill
  skillSyncMethod: z.enum(["auto", "symlink", "copy"]).optional(),
  skillStorageLocation: z.enum(["cc_switch", "unified"]).optional(),

  // Configuración de sincronización WebDAV v2 (guardada mediante comando dedicado, schema solo para lectura)
  webdavSync: z
    .object({
      enabled: z.boolean().optional(),
      autoSync: z.boolean().optional(),
      baseUrl: z.string().trim().optional().or(z.literal("")),
      username: z.string().trim().optional().or(z.literal("")),
      password: z.string().optional(),
      remoteRoot: z.string().trim().optional().or(z.literal("")),
      profile: z.string().trim().optional().or(z.literal("")),
      status: z
        .object({
          lastSyncAt: z.number().nullable().optional(),
          lastError: z.string().nullable().optional(),
          lastErrorSource: z.string().nullable().optional(),
          lastRemoteEtag: z.string().nullable().optional(),
          lastLocalManifestHash: z.string().nullable().optional(),
          lastRemoteManifestHash: z.string().nullable().optional(),
        })
        .optional(),
    })
    .optional(),
});

export type SettingsFormData = z.infer<typeof settingsSchema>;
