import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import es from "./locales/es.json";

type Language = "es" | "en";

const DEFAULT_LANGUAGE: Language = "es";

const getInitialLanguage = (): Language => {
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem("language");
      if (stored === "es" || stored === "en") {
        return stored;
      }
    } catch (error) {
      console.warn("[i18n] No se pudo leer el idioma guardado", error);
    }
  }

  const navigatorLang =
    typeof navigator !== "undefined"
      ? (navigator.language?.toLowerCase() ??
        navigator.languages?.[0]?.toLowerCase())
      : undefined;

  if (navigatorLang?.startsWith("en")) {
    return "en";
  }

  // Cualquier otro idioma del navegador cae al predeterminado (español).
  return DEFAULT_LANGUAGE;
};

const resources = {
  es: {
    translation: es,
  },
  en: {
    translation: en,
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: getInitialLanguage(),
  fallbackLng: "es",

  interpolation: {
    escapeValue: false, // React ya escapa por defecto
  },

  // Mostrar información de depuración en modo desarrollo
  debug: false,
});

export default i18n;
