# ENTREGABLE 5: Contratos de Tools para Retail

## Resumen de Tools

| Tool | Categoría | Confirmación | Risk | Idempotency Key |
|------|-----------|--------------|------|-----------------|
| `create_order_draft` | mutation | No | low | `draft:{sessionId}:{timestamp}` |
| `add_item_to_draft` | mutation | No | low | `item:{orderId}:{productId}:{variantId}:{timestamp}` |
| `set_delivery_details` | mutation | No | low | `delivery:{orderId}:{timestamp}` |
| `request_confirmation` | mutation | No | low | `confirm_request:{orderId}:{timestamp}` |
| `confirm_order` | mutation | **YES** | high | `confirm:{orderId}:{confirmationToken}` |
| `adjust_stock` | mutation | **YES*** | high | `stock:{productId}:{variantId}:{reason}:{timestamp}` |
| `register_payment` | mutation | **YES*** | high | `payment:{orderId}:{externalId}` |
| `attach_receipt` | mutation | No | low | `receipt:{paymentId}:{fileHash}` |
| `get_customer_context` | query | No | low | N/A |
| `list_products` | query | No | low | N/A |
| `send_catalog` | mutation | No | low | N/A |

*Confirmación condicional (ver reglas de negocio)

---

## Constantes de Negocio

```typescript
const BUSINESS_RULES = {
  MAX_DISCOUNT_PERCENT: 30,        // Descuento máximo permitido
  MAX_ITEMS_PER_ORDER: 50,         // Máximo items por pedido
  MAX_QUANTITY_PER_ITEM: 100,      // Máxima cantidad por línea
  FREE_SHIPPING_THRESHOLD: 50000,  // $500 para envío gratis
  RECEIPT_REQUIRED_THRESHOLD: 100000, // Receipt obligatorio > $1000
  STOCK_ADJUSTMENT_LIMIT: 100,     // Ajuste sin aprobación manager
  DRAFT_EXPIRY_MINUTES: 30,        // Expiración de draft
};
```

---

## 1. create_order_draft

Crea un nuevo draft de pedido para el cliente.

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "customerId": { "type": "string", "format": "uuid" },
    "notes": { "type": "string", "maxLength": 500 },
    "currency": { "type": "string", "enum": ["ARS", "USD", "BRL", "CLP", "MXN"], "default": "ARS" },
    "idempotencyKey": { "type": "string", "minLength": 16, "maxLength": 64 }
  }
}
```

### Output Schema

```json
{
  "type": "object",
  "required": ["orderId", "orderNumber", "status", "expiresAt", "message"],
  "properties": {
    "orderId": { "type": "string", "format": "uuid" },
    "orderNumber": { "type": "string" },
    "status": { "const": "draft" },
    "expiresAt": { "type": "string", "format": "date-time" },
    "message": { "type": "string" }
  }
}
```

### Reglas de Negocio
- Solo un draft activo por sesión/customer
- Draft expira en 30 minutos
- CustomerId se infiere de la sesión si no se provee

### Confirmación Humana
**NO** - Operación segura, solo crea draft

### Idempotency Key
`draft:{sessionId}:{timestamp}`

---

## 2. add_item_to_draft

Agrega un producto al draft de pedido.

### Input Schema

```json
{
  "type": "object",
  "required": ["orderId", "productId", "quantity"],
  "properties": {
    "orderId": { "type": "string", "format": "uuid" },
    "productId": { "type": "string", "format": "uuid" },
    "variantId": { "type": "string", "format": "uuid" },
    "quantity": { "type": "integer", "minimum": 1, "maximum": 100 },
    "discountPercent": { "type": "number", "minimum": 0, "maximum": 30, "default": 0 },
    "notes": { "type": "string", "maxLength": 200 },
    "idempotencyKey": { "type": "string", "minLength": 16, "maxLength": 64 }
  }
}
```

### Output Schema

```json
{
  "type": "object",
  "required": ["itemId", "orderId", "product", "quantity", "lineTotal", "orderTotals", "message"],
  "properties": {
    "itemId": { "type": "string", "format": "uuid" },
    "orderId": { "type": "string", "format": "uuid" },
    "product": {
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "sku": { "type": "string" },
        "name": { "type": "string" },
        "unitPrice": { "type": "integer" }
      }
    },
    "quantity": { "type": "integer" },
    "lineTotal": { "type": "integer" },
    "discountAmount": { "type": "integer" },
    "stockAvailable": { "type": "integer" },
    "orderTotals": {
      "type": "object",
      "properties": {
        "subtotal": { "type": "integer" },
        "discount": { "type": "integer" },
        "tax": { "type": "integer" },
        "total": { "type": "integer" },
        "itemCount": { "type": "integer" }
      }
    },
    "message": { "type": "string" }
  }
}
```

### Reglas de Negocio
- **Stock disponible**: `quantity <= stockAvailable`
- **Máximo items**: `orderTotals.itemCount <= 50`
- **Cantidad máxima**: `quantity <= 100`
- **Descuento máximo**: `discountPercent <= 30%`
- Producto debe estar activo (status = 'active')

### Confirmación Humana
**NO** - Solo modifica draft, no compromete stock

### Idempotency Key
`item:{orderId}:{productId}:{variantId}:{timestamp}`

---

## 3. set_delivery_details

Configura dirección de envío y método de entrega.

### Input Schema

```json
{
  "type": "object",
  "required": ["orderId", "address"],
  "properties": {
    "orderId": { "type": "string", "format": "uuid" },
    "address": {
      "type": "object",
      "required": ["recipientName", "line1", "city"],
      "properties": {
        "recipientName": { "type": "string", "minLength": 2, "maxLength": 100 },
        "recipientPhone": { "type": "string", "pattern": "^\\+[1-9]\\d{1,14}$" },
        "line1": { "type": "string", "minLength": 5, "maxLength": 255 },
        "line2": { "type": "string", "maxLength": 255 },
        "city": { "type": "string", "minLength": 2, "maxLength": 100 },
        "state": { "type": "string", "maxLength": 100 },
        "postalCode": { "type": "string", "maxLength": 20 },
        "country": { "type": "string", "minLength": 2, "maxLength": 2, "default": "AR" },
        "instructions": { "type": "string", "maxLength": 500 }
      }
    },
    "shippingMethod": {
      "type": "string",
      "enum": ["standard", "express", "pickup", "same_day"],
      "default": "standard"
    },
    "preferredDate": { "type": "string", "format": "date-time" },
    "idempotencyKey": { "type": "string" }
  }
}
```

### Reglas de Negocio
- **Envío gratis**: `orderTotal >= $500 (50000 cents)`
- Dirección debe estar completa (line1, city obligatorios)
- País debe ser código ISO válido

### Confirmación Humana
**NO** - Solo configura dirección

### Idempotency Key
`delivery:{orderId}:{timestamp}`

---

## 4. request_confirmation

Genera resumen del pedido y solicita confirmación al cliente.

### Input Schema

```json
{
  "type": "object",
  "required": ["orderId"],
  "properties": {
    "orderId": { "type": "string", "format": "uuid" },
    "includeBreakdown": { "type": "boolean", "default": true },
    "customMessage": { "type": "string", "maxLength": 500 },
    "idempotencyKey": { "type": "string" }
  }
}
```

### Output Schema

```json
{
  "type": "object",
  "required": ["orderId", "orderNumber", "status", "summary", "confirmationMessage", "expiresAt"],
  "properties": {
    "orderId": { "type": "string" },
    "orderNumber": { "type": "string" },
    "status": { "const": "pending_confirmation" },
    "summary": {
      "type": "object",
      "properties": {
        "items": { "type": "array" },
        "deliveryAddress": { "type": "string" },
        "shippingMethod": { "type": "string" },
        "totals": { "type": "object" }
      }
    },
    "confirmationMessage": { "type": "string" },
    "expiresAt": { "type": "string", "format": "date-time" },
    "expectedResponses": {
      "type": "array",
      "items": { "type": "string" },
      "example": ["Confirmo", "Sí, proceder", "OK"]
    }
  }
}
```

### Reglas de Negocio
- Pedido debe tener **al menos 1 item**
- **Delivery details** deben estar configurados
- **Stock** debe seguir disponible para todos los items
- Genera mensaje formateado para WhatsApp

### Confirmación Humana
**NO** - Esta tool ES la solicitud de confirmación

### Idempotency Key
`confirm_request:{orderId}:{timestamp}`

---

## 5. confirm_order ⚠️

**ACCIÓN CRÍTICA** - Confirma el pedido, compromete stock e inicia pago.

### Input Schema

```json
{
  "type": "object",
  "required": ["orderId", "confirmationToken", "paymentMethod"],
  "properties": {
    "orderId": { "type": "string", "format": "uuid" },
    "confirmationToken": { "type": "string", "minLength": 1 },
    "paymentMethod": {
      "type": "string",
      "enum": ["mercadopago", "cash", "transfer", "credit_card", "debit_card"]
    },
    "paymentInstructions": { "type": "string", "maxLength": 500 },
    "idempotencyKey": { "type": "string" }
  }
}
```

### Reglas de Negocio
- Pedido debe estar en **status = 'pending_confirmation'**
- **confirmationToken** debe coincidir (del mensaje del cliente)
- **Stock reservations** deben seguir válidas
- **Commits stock** (deducción permanente)
- **Inicia proceso de pago**

### Confirmación Humana
**SÍ - OBLIGATORIO** ⚠️

El agente debe solicitar confirmación explícita del cliente antes de ejecutar.
Frases aceptadas: "Confirmo", "Sí", "Proceder", "Dale", "OK"

### Idempotency Key
`confirm:{orderId}:{confirmationToken}`

---

## 6. adjust_stock ⚠️

Ajusta niveles de inventario.

### Input Schema

```json
{
  "type": "object",
  "required": ["productId", "adjustmentType", "quantity", "reason"],
  "properties": {
    "productId": { "type": "string", "format": "uuid" },
    "variantId": { "type": "string", "format": "uuid" },
    "adjustmentType": {
      "type": "string",
      "enum": ["increase", "decrease", "correction", "return"]
    },
    "quantity": { "type": "integer", "minimum": 1 },
    "reason": { "type": "string", "minLength": 10, "maxLength": 500 },
    "reference": { "type": "string", "maxLength": 100 },
    "location": { "type": "string", "maxLength": 100 },
    "idempotencyKey": { "type": "string" }
  }
}
```

### Reglas de Negocio
- **Stock no negativo**: `newQuantity >= 0`
- **Ajustes grandes requieren aprobación**: `quantity > 100`
- **Reason obligatorio** para audit trail
- Genera `stock.low` event si baja del threshold

### Confirmación Humana
**SÍ si `quantity > 100`** (STOCK_ADJUSTMENT_LIMIT)

### Idempotency Key
`stock:{productId}:{variantId}:{reason}:{timestamp}`

---

## 7. register_payment ⚠️

Registra un pago para un pedido.

### Input Schema

```json
{
  "type": "object",
  "required": ["orderId", "method", "amount"],
  "properties": {
    "orderId": { "type": "string", "format": "uuid" },
    "method": {
      "type": "string",
      "enum": ["mercadopago", "cash", "transfer", "credit_card", "debit_card", "other"]
    },
    "amount": { "type": "integer", "minimum": 1 },
    "currency": { "type": "string", "default": "ARS" },
    "externalId": { "type": "string", "maxLength": 255 },
    "reference": { "type": "string", "maxLength": 255 },
    "notes": { "type": "string", "maxLength": 500 },
    "receiptId": { "type": "string", "format": "uuid" },
    "idempotencyKey": { "type": "string" }
  }
}
```

### Reglas de Negocio
- **Monto debe cubrir total**: `amount >= orderTotal` (o permitir pagos parciales)
- **Receipt obligatorio si amount > $1000**:
  ```
  if (amount >= 100000 && method !== 'mercadopago') {
    receiptId is required
  }
  ```
- **Pagos cash/transfer requieren confirmación manual**

### Confirmación Humana
**SÍ si `method in ['cash', 'transfer']`**

### Idempotency Key
`payment:{orderId}:{externalId}` o `payment:{orderId}:{timestamp}`

---

## 8. attach_receipt

Adjunta comprobante de pago.

### Input Schema

```json
{
  "type": "object",
  "required": ["paymentId", "fileType", "fileName", "fileSize", "content"],
  "properties": {
    "paymentId": { "type": "string", "format": "uuid" },
    "fileType": {
      "type": "string",
      "enum": ["image/jpeg", "image/png", "image/webp", "application/pdf"]
    },
    "fileName": { "type": "string", "maxLength": 255 },
    "fileSize": { "type": "integer", "minimum": 1, "maximum": 10485760 },
    "content": { "type": "string", "description": "URL or data URI" },
    "receiptType": {
      "type": "string",
      "enum": ["payment_proof", "invoice", "transfer_receipt", "other"],
      "default": "payment_proof"
    },
    "idempotencyKey": { "type": "string" }
  }
}
```

### Reglas de Negocio
- **Tamaño máximo**: 10MB
- **Tipos válidos**: JPEG, PNG, WebP, PDF
- Obligatorio para pagos > $1000 (excepto MercadoPago)

### Confirmación Humana
**NO** - Solo adjunta archivo

### Idempotency Key
`receipt:{paymentId}:{fileHash}`

---

## 9. get_customer_context

Obtiene información del cliente y su historial.

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "customerId": { "type": "string", "format": "uuid" },
    "phone": { "type": "string", "pattern": "^\\+[1-9]\\d{1,14}$" },
    "includeOrders": { "type": "boolean", "default": true },
    "orderLimit": { "type": "integer", "minimum": 1, "maximum": 20, "default": 5 },
    "includePreferences": { "type": "boolean", "default": true }
  },
  "anyOf": [
    { "required": ["customerId"] },
    { "required": ["phone"] }
  ]
}
```

### Reglas de Negocio
- **Scope workspace**: Solo clientes del mismo workspace
- **PII limitado**: Según configuración de retención

### Confirmación Humana
**NO** - Solo lectura

### Idempotency Key
N/A (read-only)

---

## 10. list_products

Lista o busca productos del catálogo.

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "query": { "type": "string", "maxLength": 200 },
    "category": { "type": "string", "maxLength": 200 },
    "minPrice": { "type": "integer", "minimum": 0 },
    "maxPrice": { "type": "integer", "minimum": 1 },
    "inStockOnly": { "type": "boolean", "default": false },
    "includeStock": { "type": "boolean", "default": true },
    "includeVariants": { "type": "boolean", "default": false },
    "sortBy": {
      "type": "string",
      "enum": ["name", "price_asc", "price_desc", "popularity", "newest"],
      "default": "name"
    },
    "page": { "type": "integer", "minimum": 1, "default": 1 },
    "pageSize": { "type": "integer", "minimum": 1, "maximum": 50, "default": 10 }
  }
}
```

### Reglas de Negocio
- Solo productos **status = 'active'**
- Respeta configuración del workspace

### Confirmación Humana
**NO** - Solo lectura

### Idempotency Key
N/A (read-only)

---

## 11. send_catalog

Envía catálogo formateado por WhatsApp.

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "productIds": {
      "type": "array",
      "items": { "type": "string", "format": "uuid" },
      "maxItems": 10
    },
    "category": { "type": "string" },
    "query": { "type": "string" },
    "includePrices": { "type": "boolean", "default": true },
    "includeStock": { "type": "boolean", "default": true },
    "format": {
      "type": "string",
      "enum": ["list", "carousel", "detailed"],
      "default": "list"
    },
    "headerMessage": { "type": "string", "maxLength": 200 },
    "footerMessage": { "type": "string", "maxLength": 200 }
  },
  "anyOf": [
    { "required": ["productIds"] },
    { "required": ["category"] },
    { "required": ["query"] }
  ]
}
```

### Reglas de Negocio
- **Máximo 10 productos** por mensaje (limitación WhatsApp)
- Formatea output para legibilidad en WhatsApp

### Confirmación Humana
**NO** - Solo envía mensaje

### Idempotency Key
N/A (envío de mensaje)

---

## Matriz de Seguridad

```
┌──────────────────────────┬───────────┬─────────────┬─────────────┬───────────────┐
│ Tool                     │ Confirm   │ Risk Level  │ Rate Limit  │ Audit Level   │
├──────────────────────────┼───────────┼─────────────┼─────────────┼───────────────┤
│ create_order_draft       │    No     │    Low      │   10/min    │    Basic      │
│ add_item_to_draft        │    No     │    Low      │   30/min    │    Basic      │
│ set_delivery_details     │    No     │    Low      │   10/min    │    Basic      │
│ request_confirmation     │    No     │    Low      │    5/min    │    Basic      │
│ confirm_order            │   YES     │   HIGH      │    5/min    │   FULL        │
│ adjust_stock             │  YES*     │   HIGH      │   20/min    │   FULL        │
│ register_payment         │  YES*     │   HIGH      │   10/min    │   FULL        │
│ attach_receipt           │    No     │    Low      │   10/min    │    Basic      │
│ get_customer_context     │    No     │    Low      │   30/min    │    None       │
│ list_products            │    No     │    Low      │   60/min    │    None       │
│ send_catalog             │    No     │    Low      │   10/min    │    Basic      │
└──────────────────────────┴───────────┴─────────────┴─────────────┴───────────────┘

* Confirmación condicional según reglas de negocio
```

---

## Flujo de Pedido Típico

```
1. get_customer_context     → Obtener historial y preferencias
2. list_products            → Mostrar catálogo al cliente
3. create_order_draft       → Crear draft cuando cliente quiere comprar
4. add_item_to_draft (x N)  → Agregar items según cliente solicita
5. set_delivery_details     → Configurar dirección de envío
6. request_confirmation     → Mostrar resumen y pedir confirmación
7. confirm_order            → ⚠️ CONFIRMAR (requiere aprobación humana)
8. register_payment         → Registrar pago recibido
9. attach_receipt           → Adjuntar comprobante si necesario
```

---

## ASSUMPTIONS

1. **ASSUMPTION:** Los precios se manejan en centavos (integer) para evitar problemas de floating point.

2. **ASSUMPTION:** El `confirmationToken` en `confirm_order` se genera del mensaje del cliente (hash del texto + timestamp).

3. **ASSUMPTION:** Rate limits son por sesión/customer, no globales del workspace.

4. **ASSUMPTION:** El descuento máximo (30%) es configurable por workspace en `workspace.settings`.

5. **ASSUMPTION:** Los pagos con MercadoPago no requieren receipt porque el gateway proporciona comprobante automático.

6. **ASSUMPTION:** El formato de catálogo "carousel" usa WhatsApp Interactive Messages si está disponible.
