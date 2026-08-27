# Solución de problemas

## La app muestra "Error al inicializar la base de datos"

El diálogo indica la ruta del archivo. Debe ser:

```
C:\Users\<usuario>\.resuelve-api\resuelve-api.db
```

Si apunta a otra carpeta, hay una ruta de datos personalizada configurada en Ajustes. Vuelve a la
ruta por defecto.

Si el archivo está corrupto: cierra la app, renombra `resuelve-api.db` (no lo borres, por si quieres
recuperar claves) y abre la app de nuevo para que cree uno limpio.

---

## El campo "Clave API" está en gris y no deja escribir

El texto del campo dice "El inicio de sesión oficial no requiere Clave API".

**Causa**: esa tarjeta usa autenticación del propio servicio (login en navegador u OAuth) en lugar de
clave.

**Solución**: usa la tarjeta **Resuelve-API (Alta Velocidad)**, que sí pide clave.

---

## Cambié el proveedor pero la CLI sigue usando el anterior

Las CLI leen la configuración al arrancar.

1. Cierra **todas** las terminales abiertas.
2. Abre una nueva.
3. Vuelve a ejecutar la CLI.

Si persiste, comprueba que no tengas variables de entorno del sistema pisando la configuración: una
`ANTHROPIC_BASE_URL` definida en Windows tiene prioridad sobre `settings.json`. La app avisa de estos
conflictos con un banner.

---

## Claude Desktop deja de responder

El proveedor de Claude Desktop funciona con un proxy local: **la app debe seguir abierta**. Minimizarla
al icono de bandeja está bien; cerrarla del todo corta la conexión.

---

## Error 401 / no autorizado al usar la CLI

Por orden de probabilidad:

1. La clave está mal pegada: espacios al inicio o al final, o pegada a medias.
2. La clave no tiene saldo o permisos.
3. El modelo solicitado no existe en el servidor. Un modelo inexistente puede devolver 401 o 404
   según la configuración.

Para descartar el punto 3, prueba con un modelo que sepas que está disponible en tu cuenta.

---

## SmartScreen bloquea el instalador

Esperado: el ejecutable no está firmado. **Más información** → **Ejecutar de todas formas**.

Si tu organización bloquea ejecutables no firmados por política, compila el proyecto tú mismo
siguiendo [DESARROLLO.md](DESARROLLO.md).

---

## Dónde mirar cuando nada de lo anterior encaja

```
%USERPROFILE%\.resuelve-api\logs\
%USERPROFILE%\.resuelve-api\crash.log
```

El registro incluye la ruta de la base de datos usada, los proveedores creados al arrancar y los
errores al escribir configuración.
