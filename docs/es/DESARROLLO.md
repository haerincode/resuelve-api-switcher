# Desarrollo y compilación

Compilar desde el código es también la forma de verificar que el instalador publicado no lleva nada
extra.

## Requisitos

| Herramienta | Versión | Nota |
|---|---|---|
| Node.js | 20+ | usa `npm`; ver la advertencia sobre `pnpm` más abajo |
| Rust | 1.95 (fijado en `rust-toolchain.toml`) | |
| Visual Studio Build Tools | con "Desktop development with C++" | necesario para enlazar en Windows |
| WebView2 | preinstalado en Windows 11 | |

## Instalar dependencias

```bash
npm install --legacy-peer-deps
npm rebuild esbuild
```

`npm rebuild esbuild` hace falta porque npm bloquea por política los scripts de instalación de
`esbuild`.

> No uses `pnpm install` aquí: deja bloqueados los scripts de `esbuild` y `msw`, y `tauri build`
> aborta con `ERR_PNPM_IGNORED_BUILDS`.

## Comandos

```bash
# Comprobar tipos
npx tsc --noEmit

# Solo frontend (~15 s) → genera dist/
npx vite build

# Solo backend Rust, sin empaquetar
cd src-tauri && cargo build --release

# Aplicación completa, sin instalador (~10 min)
npx @tauri-apps/cli build --no-bundle

# Aplicación + instalador (~15 min)
npx @tauri-apps/cli build

# Desarrollo con recarga en caliente
npx @tauri-apps/cli dev
```

El instalador queda en:

```
src-tauri/target/release/bundle/nsis/Resuelve-API Switcher_1.0.0_x64-setup.exe
```

### Dos detalles que ahorran tiempo

**El frontend va embebido en el ejecutable.** Cambiar React/TypeScript y ejecutar `vite build` no
basta: hay que volver a enlazar el binario, que es la parte lenta. Agrupa los cambios de frontend
antes de recompilar, o usa `tauri dev`.

**Cierra la app antes de compilar.** Si el ejecutable está corriendo, el enlazado falla:

```
error: failed to remove file `...\resuelve-api-switcher.exe`
Caused by: Acceso denegado. (os error 5)
```

---

## Dónde está cada cosa

| Qué | Archivo |
|---|---|
| Proveedores de Claude Code | `src/config/claudeProviderPresets.ts` |
| Proveedores de Codex | `src/config/codexProviderPresets.ts` |
| Proveedores de Gemini | `src/config/geminiProviderPresets.ts` |
| Proveedores de Claude Desktop | `src/config/claudeDesktopProviderPresets.ts` |
| Proveedores creados al arrancar | `src-tauri/src/database/dao/providers_seed.rs` |
| Traducciones | `src/i18n/locales/es.json` |
| Idioma por defecto | `src/i18n/index.ts` |
| Nombre, icono, identificador | `src-tauri/tauri.conf.json` |
| Overrides de Windows | `src-tauri/tauri.windows.conf.json` |
| Carpeta de datos y nombre de la BD | `src-tauri/src/config.rs` |
| Icono de origen | `src-tauri/icons/` (regenerar con `tauri icon <png>`) |

### Trampa con `tauri.windows.conf.json`

En Windows ese archivo **pisa** valores de `tauri.conf.json`; el título de la ventana se define ahí.
Cambiar solo `tauri.conf.json` no surte efecto en Windows.

### Categorías de proveedor

La categoría decide si el formulario pide clave:

- `official` → **deshabilita** el campo Clave API (pensado para login del propio servicio).
- `third_party`, `aggregator`, `custom` → pide clave.

El proveedor de Resuelve-API **debe** ser `third_party`. Si se marca como `official`, el campo de
clave queda en gris.

Hay que declararlo en dos sitios: el preset del frontend y el `category` del seed en
`providers_seed.rs`.

### Proveedores creados al arrancar

`init_default_official_providers()` corre al iniciar y sale antes si existe el ajuste
`official_providers_seeded`. Para forzarlo de nuevo en una base de datos existente:

```sql
DELETE FROM settings WHERE key = 'official_providers_seeded';
```

Los ids existentes se respetan; solo se insertan los que falten.

---

## Modelos y endpoints

Los modelos preconfigurados (`gpt-5.4`, `gemini-3.1-pro`, `claude-sonnet-5`, `claude-opus-5`,
`claude-3-5-haiku-20241022`) **no están verificados** contra el servidor: `/v1/models` requiere clave,
así que no se pudo listar el catálogo real.

Si el catálogo difiere, ajústalos en los cuatro archivos de presets y en `providers_seed.rs`.

---

## Empaquetado

En `src-tauri/tauri.conf.json`:

```json
"targets": ["nsis", "msi"],
"createUpdaterArtifacts": false
```

### `createUpdaterArtifacts` en `false`

Generar artefactos de actualización exige firmarlos con una clave privada minisign. Sin ella, el
empaquetado falla. Para habilitar actualizaciones propias:

```bash
npx @tauri-apps/cli signer generate -w resuelve-api.key
```

Pon la clave pública en `plugins.updater.pubkey`, cambia `active` a `true`, define un endpoint propio
que sirva `latest.json` y exporta `TAURI_SIGNING_PRIVATE_KEY` al compilar.

### El MSI falla

`light.exe` (WiX) falla y Tauri no muestra su salida real. El NSIS sí se genera y es funcional. Para
diagnosticarlo, ejecuta WiX a mano:

```bash
cd src-tauri/target/release/wix/x64
~/AppData/Local/tauri/WixTools314/candle.exe main.wxs
~/AppData/Local/tauri/WixTools314/light.exe main.wixobj
```

Sospechoso principal: la plantilla personalizada `src-tauri/wix/per-user-main.wxs`. Quitar la clave
`bundle.windows.wix.template` haría que Tauri use su plantilla estándar.

### Firma de código

Sin firma, SmartScreen avisa en cada instalación. Se resuelve con un certificado de firma de código
(OV o EV) aplicado al `setup.exe`.

---

## Estado conocido

- Instalador NSIS: funciona.
- Instalador MSI: falla en WiX.
- Auto-actualización: desactivada a propósito.
- Firma de código: ausente.
- Aviso al compilar: `bundle identifier "com.resuelveapi.app" ends with .app` — solo afecta a macOS,
  inocuo en Windows.
- El paquete arrastra ~1,7 MB de iconos que ya no se usan en ninguna pantalla.
