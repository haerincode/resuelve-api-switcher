import { invoke } from "@tauri-apps/api/core";
import type { EnvConflict, BackupInfo } from "@/types/env";

/**
 * API de gestión de variables de entorno
 */

/**
 * Verifica conflictos de variables de entorno para la aplicación especificada
 * @param appType Tipo de aplicación ("claude" | "codex" | "gemini")
 * @returns Lista de conflictos de variables de entorno
 */
export async function checkEnvConflicts(
  appType: string,
): Promise<EnvConflict[]> {
  return invoke<EnvConflict[]>("check_env_conflicts", { app: appType });
}

/**
 * Elimina las variables de entorno especificadas (se hace backup automático)
 * @param conflicts Lista de conflictos de variables de entorno a eliminar
 * @returns Información del backup
 */
export async function deleteEnvVars(
  conflicts: EnvConflict[],
): Promise<BackupInfo> {
  return invoke<BackupInfo>("delete_env_vars", { conflicts });
}

/**
 * Restaura variables de entorno desde archivo de backup
 * @param backupPath Ruta del archivo de backup
 */
export async function restoreEnvBackup(backupPath: string): Promise<void> {
  return invoke<void>("restore_env_backup", { backupPath });
}

/**
 * Verifica conflictos de variables de entorno en todas las aplicaciones
 * @returns Conflictos de variables de entorno agrupados por tipo de aplicación
 */
export async function checkAllEnvConflicts(): Promise<
  Record<string, EnvConflict[]>
> {
  const apps = ["claude", "codex", "gemini"];
  const results: Record<string, EnvConflict[]> = {};

  await Promise.all(
    apps.map(async (app) => {
      try {
        results[app] = await checkEnvConflicts(app);
      } catch (error) {
        console.error(`Error al verificar variables de entorno de ${app}:`, error);
        results[app] = [];
      }
    }),
  );

  return results;
}
