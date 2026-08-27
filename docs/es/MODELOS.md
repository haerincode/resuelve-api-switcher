# Modelos disponibles

Nombres exactos tal como hay que escribirlos en la configuración.

| Nombre para el código | Especialidad |
|---|---|
| `claude-sonnet-5` | El mejor para programar; muy rápido y económico en caché |
| `claude-opus-5` | Máxima potencia y razonamiento para tareas complejas |
| `gpt-5.6-sol` | Modelo multimodal de gama alta |
| `gpt-5.6-terra` | Muy económico y veloz, ideal para bots |
| `grok-4.6` | Respuestas directas |
| `gemini-3.7-flash` | Contexto de 1 millón de tokens |
| `qwen3.8-max` | Razonamiento y matemáticas |

## Qué modelo usa cada app por defecto

La app deja preconfigurados estos modelos al activar el proveedor:

| App | Modelo por defecto |
|---|---|
| Claude Code | `claude-sonnet-5` (Opus: `claude-opus-5`) |
| Codex CLI | `gpt-5.6-sol` |
| Gemini CLI | `gemini-3.7-flash` |
| Claude Desktop | Sonnet → `claude-sonnet-5`, Opus → `claude-opus-5` |

## Cambiar el modelo

**Claude Code**: edita la tarjeta del proveedor → opciones avanzadas → campos de modelo. Se traducen a
estas variables:

```
ANTHROPIC_MODEL
ANTHROPIC_DEFAULT_SONNET_MODEL
ANTHROPIC_DEFAULT_OPUS_MODEL
ANTHROPIC_DEFAULT_HAIKU_MODEL
```

**Codex CLI**: edita la tarjeta y cambia `model` en el bloque TOML.

**Gemini CLI**: edita `GEMINI_MODEL`.

**Claude Desktop**: los roles visibles (Sonnet, Opus, Haiku) son fijos porque la aplicación valida ese
formato, pero el modelo real que se solicita en cada rol es editable.

## Consumo y caché

El servicio es de prepago: el saldo se descuenta por token consumido, con hasta un 90 % de descuento
en los tokens que se leen desde caché.
