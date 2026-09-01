# Resuelve-API Switcher

Herramienta de escritorio oficial de **Resuelve-API**. Conecta Claude Code, Claude Desktop y Gemini CLI a Resuelve-API pegando tu Clave API una sola vez.

Versión 1.1.0 · Windows x64 · Interfaz en español

> **Nota sobre Codex:** La integración con Codex CLI está temporalmente desactivada mientras investigamos problemas de compatibilidad con el proxy local. Seguiremos trabajando en ello y avisaremos cuando esté lista. Mientras tanto, puedes usar Codex apuntando directamente a `https://resuelve-api.lat/v1` editando tu `~/.codex/config.toml` manualmente.

---

## Documentación

| Documento | Para qué sirve |
|---|---|
| [Instalación](docs/es/INSTALACION.md) | Instalar, desinstalar, aviso de SmartScreen, dónde queda todo |
| [Guía de uso](docs/es/USO.md) | Pegar la clave y conectar cada CLI, paso a paso |
| [Modelos](docs/es/MODELOS.md) | Catálogo y cómo cambiar el modelo de cada app |
| [Usar la API directamente](docs/es/API.md) | Cursor, Cline, Windsurf, Python, Node.js, cURL |
| [Solución de problemas](docs/es/PROBLEMAS.md) | Errores conocidos y cómo resolverlos |
| [Desarrollo y compilación](docs/es/DESARROLLO.md) | Compilar el código y generar el instalador |
| [Marco legal](docs/es/LEGAL.md) | Privacidad, precios, reembolsos, licencia |

---

## Qué hace

Las CLI de Claude Code, Codex y Gemini leen su configuración de archivos en tu carpeta de usuario
(`~/.claude/settings.json`, `~/.codex/`, `~/.gemini/`). Configurarlas a mano significa editar esos
archivos sin equivocarse.

Esta app lo hace por ti:

1. Pegas tu Clave API de Resuelve-API en la tarjeta del proveedor.
2. Pulsas activar.
3. La app escribe la configuración de la CLI correspondiente apuntando a Resuelve-API.

Antes de sobrescribir, guarda tu configuración anterior como un proveedor llamado `default`, así que
puedes volver atrás sin perder nada.

---

## Código abierto y verificable

El código completo está en este repositorio. Lo que puedes comprobar por ti mismo:

- **Tu clave no sale de tu equipo.** Se guarda en `%USERPROFILE%\.resuelve-api\resuelve-api.db` y se
  escribe en los archivos de configuración de la CLI. No se envía a ningún servicio de telemetría.
- **No hay telemetría ni analítica.** Busca en el código: no hay envío de datos de uso.
- **Las peticiones van a donde dice la configuración**, que es visible y editable en la propia app.
- **Sin auto-actualización silenciosa.** La comprobación de actualizaciones está desactivada; las
  versiones nuevas se instalan a mano.

Cómo verificarlo tú mismo: compila desde el código con las instrucciones de
[DESARROLLO.md](docs/es/DESARROLLO.md) y compara el resultado con el instalador publicado.

---

## Instalación rápida

1. Ejecuta `Resuelve-API Switcher_1.0.0_x64-setup.exe`.
2. Windows mostrará "Editor desconocido" → **Más información** → **Ejecutar de todas formas**
   (el ejecutable no está firmado con certificado de código).
3. Se instala solo para tu usuario, sin permisos de administrador, en
   `%LOCALAPPDATA%\Programs\Resuelve-API Switcher`.

Detalle completo en [docs/es/INSTALACION.md](docs/es/INSTALACION.md).

---

## Uso en 30 segundos

1. Abre **Resuelve-API Switcher**.
2. Elige la CLI que quieras configurar: Claude, Codex, Gemini o Claude Desktop.
3. En la tarjeta **Resuelve-API (Alta Velocidad)**, pulsa editar.
4. Pega tu Clave API en el campo **Clave API** y guarda.
5. Pulsa la tarjeta para activarla.
6. Abre una terminal nueva y ejecuta tu CLI.

> El paso 6 importa: las CLI leen la configuración al arrancar. Una terminal que ya estaba abierta
> sigue usando la configuración anterior.

Detalle por CLI en [docs/es/USO.md](docs/es/USO.md).

---

## Requisitos

- Windows 10/11 x64.
- La CLI que quieras usar, instalada por separado (esta app configura, no instala las CLI).
- Una Clave API de Resuelve-API.

---

## Endpoints preconfigurados

| App | Configuración que escribe |
|---|---|
| Claude Code | `ANTHROPIC_BASE_URL=https://resuelve-api.lat/v1` + `ANTHROPIC_AUTH_TOKEN` + modelo `claude-sonnet-5` |
| Codex CLI | `auth.json` con `OPENAI_API_KEY` + `config.toml` con `base_url=.../v1`, `wire_api="chat"`, modelo `gpt-5.6-sol` |
| Gemini CLI | `GOOGLE_GEMINI_BASE_URL=https://resuelve-api.lat` + `GEMINI_API_KEY` + modelo `gemini-3.7-flash` |
| Claude Desktop | Proxy local hacia `.../v1`, Sonnet → `claude-sonnet-5`, Opus → `claude-opus-5` |

Catálogo completo de modelos en [docs/es/MODELOS.md](docs/es/MODELOS.md).

¿No usas estas CLI? El servicio es compatible con el formato de OpenAI, así que funciona en Cursor,
Cline, Windsurf o desde tu propio código: ver [docs/es/API.md](docs/es/API.md).

---

## Dónde se guardan tus datos

Todo vive en `%USERPROFILE%\.resuelve-api\`:

```
.resuelve-api\
├── resuelve-api.db      Proveedores, claves y ajustes
├── backups\             Respaldos de configuración
├── logs\                Registro de la app
└── crash.log            Solo si la app se cierra por un error
```

---

## Licencia

MIT. Ver [LICENSE](LICENSE).

## Términos del servicio

Resuelve-API es una pasarela independiente de enrutamiento técnico, sin afiliación oficial ni
patrocinio de marcas registradas de terceros. Privacidad, precios y reembolsos en
[docs/es/LEGAL.md](docs/es/LEGAL.md).
