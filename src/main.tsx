import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { UpdateProvider } from "./contexts/UpdateContext";
import "./index.css";
// Importar configuración de internacionalización
import i18n from "./i18n";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/components/theme-provider";
import { queryClient } from "@/lib/query";
import { Toaster } from "@/components/ui/sonner";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import { exit } from "@tauri-apps/plugin-process";

// Agregar body class según la plataforma para estilos específicos
try {
  const ua = navigator.userAgent || "";
  const plat = (navigator.platform || "").toLowerCase();
  const isMac = /mac/i.test(ua) || plat.includes("mac");
  if (isMac) {
    document.body.classList.add("is-mac");
  }
} catch {
  // Ignorar fallo en detección de plataforma
}

// Tipo de payload de error de carga de configuración
interface ConfigLoadErrorPayload {
  path?: string;
  error?: string;
}

/**
 * Manejar fallo de carga de configuración: mostrar mensaje de error y forzar salida de la aplicación
 * No dar al usuario la opción de "Cancelar", porque la aplicación no puede ejecutarse normalmente con configuración corrupta
 */
async function handleConfigLoadError(
  payload: ConfigLoadErrorPayload | null,
): Promise<void> {
  const path = payload?.path ?? "~/.resuelve-api/config.json";
  const detail = payload?.error ?? "Unknown error";

  await message(
    i18n.t("errors.configLoadFailedMessage", {
      path,
      detail,
      defaultValue:
        "No se pudo leer el archivo de configuración:\n{{path}}\n\nDetalles del error:\n{{detail}}\n\nPor favor, verifique manualmente que el JSON sea válido, o restaure desde un archivo de respaldo en el mismo directorio (como config.json.bak).\n\nLa aplicación se cerrará para que pueda realizar la corrección.",
    }),
    {
      title: i18n.t("errors.configLoadFailedTitle", {
        defaultValue: "Error al cargar configuración",
      }),
      kind: "error",
    },
  );

  await exit(1);
}

// Escuchar evento de error de carga de configuración del backend: solo alertar al usuario y forzar salida, sin modificar archivos de configuración
try {
  void listen("configLoadError", async (evt) => {
    await handleConfigLoadError(evt.payload as ConfigLoadErrorPayload | null);
  });
} catch (e) {
  // Ignorar excepción de suscripción a evento (por ejemplo, en entorno no Tauri)
  console.error("Fallo al suscribirse al evento configLoadError", e);
}

async function bootstrap() {
  // Consultar activamente errores de inicialización del backend al inicio para evitar condiciones de carrera de eventos
  try {
    const initError = (await invoke(
      "get_init_error",
    )) as ConfigLoadErrorPayload | null;
    if (initError && (initError.path || initError.error)) {
      await handleConfigLoadError(initError);
      // Nota: no se ejecutará aquí, porque exit(1) termina el proceso
      return;
    }
  } catch (e) {
    // Ignorar error de obtención, continuar con renderizado
    console.error("Fallo al obtener error de inicialización", e);
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider defaultTheme="system" storageKey="resuelve-api-theme">
          <UpdateProvider>
            <App />
            <Toaster />
          </UpdateProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

void bootstrap();
