# Instalación

## Requisitos

- Windows 10 o 11, 64 bits.
- No hace falta ser administrador.

## Instalar

1. Ejecuta el instalador:

   ```
   Resuelve-API Switcher_1.0.0_x64-setup.exe
   ```

2. Windows mostrará una advertencia de SmartScreen: **"Windows protegió su PC"** o
   **"Editor desconocido"**.

   Pulsa **Más información** y luego **Ejecutar de todas formas**.

   Esto ocurre porque el ejecutable no está firmado con un certificado de firma de código. No indica
   que el archivo esté dañado o modificado. Si prefieres no confiar en el binario publicado, puedes
   compilarlo tú mismo desde el código: ver [DESARROLLO.md](DESARROLLO.md).

3. Sigue el asistente. La instalación es por usuario y no pide permisos elevados.

## Dónde queda instalado

| Elemento | Ruta |
|---|---|
| Programa | `%LOCALAPPDATA%\Programs\Resuelve-API Switcher\` |
| Acceso directo | Menú Inicio → Resuelve-API Switcher |
| Datos y configuración | `%USERPROFILE%\.resuelve-api\` |

Con el usuario `oskar`, por ejemplo:

```
C:\Users\oskar\AppData\Local\Programs\Resuelve-API Switcher\
C:\Users\oskar\.resuelve-api\
```

## Qué NO hace el instalador

- No modifica la configuración de tus CLI hasta que tú actives un proveedor dentro de la app.
- No necesita conexión a internet durante la instalación.
- No instala servicios en segundo plano ni tareas programadas.

## Primera ejecución

Al abrir la app por primera vez:

1. Detecta si ya tenías configuración en `~/.claude`, `~/.codex` o `~/.gemini` y la guarda como un
   proveedor llamado `default`. Es tu red de seguridad: si algo sale mal, activas `default` y vuelves
   a como estabas.
2. Crea las tarjetas de **Resuelve-API (Alta Velocidad)** para Claude Code, Codex y Gemini.
3. Muestra un aviso de bienvenida explicando ese comportamiento.

## Actualizar

La comprobación automática de actualizaciones está **desactivada**: la app no se actualiza sola ni
descarga nada por su cuenta.

Para actualizar, ejecuta el instalador de la versión nueva encima de la anterior. Conserva tus datos,
porque viven en `%USERPROFILE%\.resuelve-api\`.

## Desinstalar

Menú Inicio → clic derecho en Resuelve-API Switcher → Desinstalar, o desde
**Configuración → Aplicaciones → Aplicaciones instaladas**.

El desinstalador **no borra** `%USERPROFILE%\.resuelve-api\`. Si quieres eliminar también tus
proveedores y claves guardadas, borra esa carpeta a mano.

Antes de borrarla, ten en cuenta que contiene tus Claves API. Si vas a reinstalar, consérvala.
