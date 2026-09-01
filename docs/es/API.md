# Usar la API directamente

Además de las CLI que configura esta app, puedes usar Resuelve-API desde cualquier editor o script
compatible con el formato de OpenAI.

## Datos de conexión

```text
Base URL:  https://resuelve-api.lat/v1
Endpoint:  https://resuelve-api.lat/v1/chat/completions
```

Compatible con el formato estándar de OpenAI.

## Crear tu Clave API

1. Inicia sesión en <https://resuelve-api.lat/>.
2. En el menú lateral entra a **Tokens / API Keys**.
3. Pulsa **Add Token**.
4. Ponle un nombre (por ejemplo `Cursor-Trabajo`), define la cuota y guarda con **Submit**.
5. Copia la clave generada (empieza por `sk-`). No la compartas.

---

## Editores de código

### Cursor

1. **Settings** → **Models**.
2. Desactiva los modelos por defecto y activa **OpenAI API Key**.
3. En **OpenAI Base URL**: `https://resuelve-api.lat/v1`
4. Pega tu clave.
5. Añade los modelos que quieras usar, por ejemplo `claude-sonnet-5` o `claude-opus-5`.

### Cline / Roo Code (extensión de VS Code)

1. En **API Provider** elige **OpenAI-Compatible**.
2. **Base URL**: `https://resuelve-api.lat/v1`
3. **API Key**: tu clave `sk-...`
4. **Model ID**: `claude-sonnet-5`

### Windsurf

1. **Settings** → **AI Provider**.
2. Elige **Custom / OpenAI Compatible**.
3. Base URL: `https://resuelve-api.lat/v1` y tu clave.

---

## Código

### Python

```python
from openai import OpenAI

client = OpenAI(
    api_key="TU_API_KEY_AQUI",
    base_url="https://resuelve-api.lat/v1",
)

response = client.chat.completions.create(
    model="claude-sonnet-5",
    messages=[
        {"role": "system", "content": "Eres un asistente experto en programación."},
        {"role": "user", "content": "Escribe una función en Python para ordenar una lista."},
    ],
)

print(response.choices[0].message.content)
```

### Node.js / TypeScript

```javascript
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: "TU_API_KEY_AQUI",
  baseURL: "https://resuelve-api.lat/v1",
});

const completion = await openai.chat.completions.create({
  model: "claude-sonnet-5",
  messages: [{ role: "user", content: "Hola, ¿cómo estás?" }],
});

console.log(completion.choices[0].message.content);
```

### cURL

```bash
curl https://resuelve-api.lat/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TU_API_KEY_AQUI" \
  -d '{
    "model": "claude-sonnet-5",
    "messages": [{"role": "user", "content": "Hola mundo!"}]
  }'
```

---

Los modelos disponibles están en [MODELOS.md](MODELOS.md).

## Manejo de la clave en tus scripts

No pegues la clave en el código que subes a un repositorio. Léela de una variable de entorno:

```python
import os
client = OpenAI(
    api_key=os.environ["RESUELVE_API_KEY"],
    base_url="https://resuelve-api.lat/v1",
)
```

## Recargas

Servicio de prepago (pay-as-you-go): el saldo se descuenta por token consumido. Para recargas en CLP o
dudas técnicas, contacta con el soporte de la plataforma.
