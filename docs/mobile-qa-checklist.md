# Mobile QA Checklist (iOS / Android)

## Scope
Flujos criticos en mobile:
1. Recarga de creditos
2. Compra de premium
3. Promocion de contenido
4. Mensajeria (chat)
5. Streaming (lista + sala + donacion)

## Environments
- iOS Safari: iPhone 13/14/15 (390x844)
- Android Chrome: Pixel 6/7/8 (412x915)
- Red: WiFi estable + 3G lenta (throttling)
- Estado de cuenta: usuario normal con y sin creditos

## Requisitos previos
- Usuario autenticado
- Al menos 1 stream disponible
- Al menos 1 conversacion activa
- Datos de notificaciones disponibles
- Creditos iniciales definidos para escenarios de exito y fallo

## Checklist global por pantalla
- [ ] Sin overflow horizontal
- [ ] CTA principal visible sin zoom
- [ ] Tap targets >= 44px
- [ ] Foco visible en inputs/botones
- [ ] Navegacion inferior consistente y usable con una mano
- [ ] Estados `loading / empty / error` visibles (nunca pantalla en blanco)
- [ ] Toasts visibles y legibles

## Casos de prueba

### 1) Recarga de creditos
**Caso 1.1 Exito**
- Abrir `Tienda` en mobile
- Seleccionar paquete de creditos
- Ejecutar recarga
- Verificar:
  - Estado: `procesando` -> `exito`
  - Toast de exito
  - Saldo actualizado

**Caso 1.2 Error controlado**
- Simular fallo de red en accion de recarga
- Verificar:
  - Estado: `fallo`
  - Mensaje accionable (reintentar)
  - Sin bloqueo de UI

**Caso 1.3 Pending webhook (si aplica en entorno)**
- Forzar respuesta pendiente
- Verificar estado visible: `pendiente de webhook`
- Verificar transicion posterior a `exito` o `fallo`

### 2) Compra premium
**Caso 2.1 Exito con saldo suficiente**
- Ejecutar compra premium
- Verificar:
  - Estado: `procesando` -> `exito`
  - Badge/estado premium actualizado
  - Toast de confirmacion

**Caso 2.2 Saldo insuficiente**
- Ejecutar compra con saldo bajo
- Verificar:
  - Estado: `fallo`
  - Mensaje claro de saldo insuficiente
  - CTA para recargar visible

### 3) Promocion de contenido
**Caso 3.1 Exito**
- Promocionar post/stream/vod propio
- Verificar:
  - Estado de pago visible
  - Registro en lista de promociones
  - Saldo descontado correctamente

**Caso 3.2 Target invalido**
- Enviar ID invalido
- Verificar:
  - Error legible
  - No rompe layout
  - Se puede corregir y reintentar

### 4) Mensajes (chat)
**Caso 4.1 Abrir y enviar**
- Entrar a `Mensajes`
- Abrir conversacion
- Enviar mensaje
- Verificar:
  - Mensaje renderiza sin refresh
  - Lista no salta bruscamente
  - Input mantiene foco correctamente

**Caso 4.2 Empty state**
- Usuario sin conversaciones
- Verificar empty state con CTA para crear

**Caso 4.3 Error state**
- Simular error de carga
- Verificar bloque de error con mensaje accionable

### 5) Streaming
**Caso 5.1 Lista de streams**
- Abrir pagina de streaming
- Verificar:
  - Skeleton durante carga
  - Empty state si no hay en vivo
  - Tarjetas legibles en viewport mobile

**Caso 5.2 Sala de stream + donacion**
- Entrar a stream
- Enviar donacion
- Verificar:
  - Estado transaccional visible
  - Toast de exito/fallo
  - Actualizacion de saldo

## A11y mobile checks
- [ ] Navegacion por teclado en dispositivos con teclado externo
- [ ] Labels asociados en formularios
- [ ] `aria-label` en botones icon-only
- [ ] Contraste minimo AA en texto y controles
- [ ] Modal cierra con `Escape` y clic en overlay

## Performance percibida checks
- [ ] Rutas pesadas abren con fallback/skeleton
- [ ] Sin congelamientos al hacer scroll en listas largas
- [ ] Avatares/previews cargan progresivamente
- [ ] No hay re-render visible excesivo al recibir realtime

## Criterio de salida
Release candidate mobile aprobado solo si:
- 0 bloqueantes
- 0 pantallas en blanco
- 0 errores silenciosos en flujos criticos
- 100% de casos 1.1, 2.1, 3.1, 4.1, 5.2 en verde
