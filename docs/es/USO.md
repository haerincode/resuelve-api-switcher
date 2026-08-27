# Guía de uso

## Concepto en una frase

Cada tarjeta de la lista es un proveedor. **Editar** guarda su configuración; **activar** la escribe
en los archivos que lee la CLI.

---

## Pasos comunes

### 1. Elige la app

En la parte superior están las apps que la herramienta puede configurar: **Claude**, **Codex**,
**Gemini**, **Claude Desktop**. Cada una tiene su propia lista de proveedores.

### 2. Pega tu Clave API

1. Localiza la tarjeta **Resuelve-API (Alta Velocidad)**.
2. Pulsa el icono de editar.
3. Pega tu clave en el campo **Clave API**.
4. **Guardar**.

La dirección del servidor ya viene rellenada. No hace falta tocarla.

### 3. Activa el proveedor

Pulsa la tarjeta. Al activarse:

- La app guarda tu configuración anterior en el proveedor `default`.
- Escribe la configuración de Resuelve-API en los archivos de la CLI.
- La tarjeta queda marcada como en uso.

### 4. Abre una terminal nueva

Las CLI leen su configuración al arrancar. Si tenías una terminal abierta, ciérrala y abre otra, o el
cambio no tendrá efecto.

---

## Qué escribe en cada CLI

### Claude Code

Archivo: `%USERPROFILE%\.claude\settings.json`

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://resuelve-api-f47v.onrender.com/v1",
    "ANTHROPIC_AUTH_TOKEN": "tu-clave"
  }
}
```

Comprobar que funciona:

```bash
claude
```

### Codex CLI

Archivos: `%USERPROFILE%\.codex\auth.json` y `%USERPROFILE%\.codex\config.toml`

```toml
model_provider = "resuelve_api"
model = "gpt-5.4"
model_reasoning_effort = "high"
disable_response_storage = true

[model_providers.resuelve_api]
name = "Resuelve-API"
base_url = "https://resuelve-api-f47v.onrender.com/v1"
wire_api = "chat"
env_key = "OPENAI_API_KEY"
```

La clave va en `auth.json` como `OPENAI_API_KEY`.

Si tu gateway sirve otros modelos, cambia `model` en el editor de configuración de la tarjeta.

### Gemini CLI

Variables de entorno que escribe:

```
GOOGLE_GEMINI_BASE_URL=https://resuelve-api-f47v.onrender.com
GEMINI_API_KEY=tu-clave
GEMINI_MODEL=gemini-3.1-pro
```

### Claude Desktop

Claude Desktop no acepta una dirección de servidor por variable de entorno, así que la app usa un
**proxy local**: Claude Desktop habla con la app, y la app reenvía a Resuelve-API.

Implicación importante: **la app tiene que quedarse abierta** mientras uses Claude Desktop con este
proveedor. Si la cierras, Claude Desktop pierde la conexión.

Rutas de modelo preconfiguradas:

| Rol en Claude Desktop | Modelo real solicitado |
|---|---|
| Sonnet | `claude-sonnet-5` |
| Opus | `claude-opus-5` |
| Haiku | `claude-3-5-haiku-20241022` |

Los nombres de rol (`claude-sonnet-*`, etc.) no se pueden cambiar libremente: Claude Desktop valida
ese formato y rechaza rutas con otros nombres. El modelo real sí es editable.

En Claude Desktop hay que añadir la tarjeta la primera vez: **Añadir proveedor** →
**Resuelve-API (Alta Velocidad)** → pegar clave → **Guardar**.

---

## Funciones útiles

### Probar latencia

En la tarjeta, el botón de medición prueba los endpoints configurados y muestra el tiempo de
respuesta. Sirve para comprobar que el servidor responde antes de lanzar la CLI.

### Volver a tu configuración anterior

Activa el proveedor `default`. Contiene exactamente lo que tenías antes de usar la app por primera
vez.

### Volver al proveedor oficial

Cada app tiene su tarjeta oficial (Claude Official, OpenAI Official, Google Official). Actívala para
usar la autenticación oficial en lugar de una Clave API.

### Cambiar de modelo

En el editor de la tarjeta, sección de opciones avanzadas, puedes fijar qué modelo se usa para cada
rol. Los modelos disponibles dependen de lo que sirva tu gateway.

### Sesiones, MCP y Ajustes

- **Herramientas (MCP)**: gestiona servidores MCP compartidos entre apps.
- **Sesiones**: histórico de sesiones de las CLI.
- **Ajustes**: idioma, tema, carpeta de datos, respaldos, inicio con el sistema.

---

## Buenas prácticas con la Clave API

- La clave se guarda en `%USERPROFILE%\.resuelve-api\resuelve-api.db` y se escribe en los archivos de
  configuración de la CLI que actives. Ambos son legibles por tu usuario de Windows.
- No compartas capturas de la pestaña de configuración con la clave visible: el botón del ojo la
  muestra en claro.
- Si sospechas que una clave se filtró, rótala en tu panel de Resuelve-API y pégala de nuevo aquí.
