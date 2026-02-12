# Retail Agent Tools - Catálogo v1

## Índice

1. [Catálogo/Stock](#1-catálogostock)
2. [Pedidos (Draft → Confirm)](#2-pedidos-draft--confirm)
3. [Modificación/Cancelación](#3-modificacióncancelación)
4. [Clientes](#4-clientes)
5. [Deuda](#5-deuda)
6. [Pagos/Comprobantes](#6-pagoscomprobantes)
7. [Mi Perfil / Config](#7-mi-perfil--config)
8. [Quick Action (Owner Dashboard)](#8-quick-action-owner-dashboard)
9. [PDF](#9-pdf)

---

## Convenciones

### Estados de Orden Procesados (No Modificables)
```typescript
const PROCESSED_STATUSES = ['processing', 'shipped', 'delivered', 'completed'];
const MODIFIABLE_STATUSES = ['draft', 'pending', 'confirmed'];
```

### Formato de Eventos
```typescript
interface DomainEvent {
  type: string;           // e.g., 'order.created'
  workspaceId: string;
  correlationId: string;
  timestamp: Date;
  payload: Record<string, unknown>;
}
```

---

## 1. Catálogo/Stock

### 1.1 `list_products`

| Campo | Valor |
|-------|-------|
| **Nombre** | `list_products` |
| **Descripción** | Lista productos del catálogo con paginación y filtros. Útil para mostrar categorías o buscar por tipo. |
| **Categoría** | QUERY |
| **Requires Confirmation** | `false` |
| **Idempotency Key** | N/A (lectura) |
| **Eventos Emitidos** | Ninguno |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "category": {
      "type": "string",
      "description": "Filtrar por categoría (ej: 'bebidas', 'lacteos')"
    },
    "inStock": {
      "type": "boolean",
      "description": "Solo productos con stock > 0",
      "default": true
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 50,
      "default": 20,
      "description": "Cantidad máxima de resultados"
    },
    "offset": {
      "type": "integer",
      "minimum": 0,
      "default": 0,
      "description": "Offset para paginación"
    },
    "sortBy": {
      "type": "string",
      "enum": ["name", "price", "popularity"],
      "default": "name",
      "description": "Campo de ordenamiento"
    }
  },
  "required": []
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "products": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": { "type": "string", "format": "uuid" },
              "name": { "type": "string" },
              "sku": { "type": "string" },
              "price": { "type": "number" },
              "category": { "type": "string" },
              "availableStock": { "type": "integer" },
              "hasVariants": { "type": "boolean" }
            }
          }
        },
        "total": { "type": "integer" },
        "hasMore": { "type": "boolean" }
      }
    },
    "error": { "type": "string" }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const ListProductsInput = z.object({
  category: z.string().min(1).max(50).optional(),
  inStock: z.boolean().default(true),
  limit: z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).default(0),
  sortBy: z.enum(['name', 'price', 'popularity']).default('name'),
});

// Validaciones adicionales:
// - Solo muestra productos con status='active' y deletedAt=null
// - Solo del workspace actual (workspaceId del contexto)
// - Si inStock=true, filtra stockItems.quantity - stockItems.reserved > 0
```

---

### 1.2 `get_product`

| Campo | Valor |
|-------|-------|
| **Nombre** | `get_product` |
| **Descripción** | Obtiene detalles completos de un producto incluyendo variantes, stock y descripción. |
| **Categoría** | QUERY |
| **Requires Confirmation** | `false` |
| **Idempotency Key** | N/A (lectura) |
| **Eventos Emitidos** | Ninguno |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "productId": {
      "type": "string",
      "format": "uuid",
      "description": "ID del producto"
    },
    "sku": {
      "type": "string",
      "description": "SKU del producto (alternativo a productId)"
    }
  },
  "oneOf": [
    { "required": ["productId"] },
    { "required": ["sku"] }
  ]
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "id": { "type": "string", "format": "uuid" },
        "name": { "type": "string" },
        "sku": { "type": "string" },
        "description": { "type": "string" },
        "price": { "type": "number" },
        "compareAtPrice": { "type": "number", "nullable": true },
        "category": { "type": "string" },
        "brand": { "type": "string", "nullable": true },
        "imageUrl": { "type": "string", "nullable": true },
        "availableStock": { "type": "integer" },
        "variants": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": { "type": "string", "format": "uuid" },
              "name": { "type": "string" },
              "sku": { "type": "string" },
              "price": { "type": "number" },
              "availableStock": { "type": "integer" }
            }
          }
        }
      }
    },
    "error": { "type": "string" }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const GetProductInput = z.object({
  productId: z.string().uuid().optional(),
  sku: z.string().min(1).max(50).optional(),
}).refine(
  (data) => data.productId || data.sku,
  { message: 'Debe proporcionar productId o sku' }
);

// Validaciones:
// - Producto debe existir y tener status='active'
// - Pertenece al workspace actual
// - Si tiene variantes, incluirlas con su stock individual
```

---

### 1.3 `search_products`

| Campo | Valor |
|-------|-------|
| **Nombre** | `search_products` |
| **Descripción** | Búsqueda de productos por texto libre. Busca en nombre, descripción, SKU y tags. Soporta fuzzy matching. |
| **Categoría** | QUERY |
| **Requires Confirmation** | `false` |
| **Idempotency Key** | N/A (lectura) |
| **Eventos Emitidos** | Ninguno |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "minLength": 2,
      "maxLength": 100,
      "description": "Texto de búsqueda (ej: 'coca cola', 'leche descremada')"
    },
    "category": {
      "type": "string",
      "description": "Filtrar por categoría específica"
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 20,
      "default": 10,
      "description": "Cantidad máxima de resultados"
    },
    "inStockOnly": {
      "type": "boolean",
      "default": true,
      "description": "Solo productos con stock disponible"
    }
  },
  "required": ["query"]
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "results": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": { "type": "string", "format": "uuid" },
              "name": { "type": "string" },
              "sku": { "type": "string" },
              "price": { "type": "number" },
              "category": { "type": "string" },
              "availableStock": { "type": "integer" },
              "matchScore": { "type": "number", "description": "Relevancia 0-1" }
            }
          }
        },
        "totalFound": { "type": "integer" },
        "suggestions": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Sugerencias si no hay resultados exactos"
        }
      }
    },
    "error": { "type": "string" }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const SearchProductsInput = z.object({
  query: z.string().min(2).max(100).describe('Texto de búsqueda'),
  category: z.string().min(1).max(50).optional(),
  limit: z.number().int().min(1).max(20).default(10),
  inStockOnly: z.boolean().default(true),
});

// Validaciones:
// - Búsqueda case-insensitive
// - Tokeniza query y busca en: name, description, sku, tags
// - Fuzzy matching con distancia de Levenshtein <= 2
// - Ordena por relevancia (matchScore)
// - Si no hay resultados, sugiere productos similares
```

---

### 1.4 `get_stock`

| Campo | Valor |
|-------|-------|
| **Nombre** | `get_stock` |
| **Descripción** | Consulta el stock disponible real de un producto o variante, considerando reservas activas. |
| **Categoría** | QUERY |
| **Requires Confirmation** | `false` |
| **Idempotency Key** | N/A (lectura) |
| **Eventos Emitidos** | Ninguno |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "productId": {
      "type": "string",
      "format": "uuid",
      "description": "ID del producto"
    },
    "variantId": {
      "type": "string",
      "format": "uuid",
      "description": "ID de la variante (opcional)"
    },
    "sku": {
      "type": "string",
      "description": "SKU alternativo"
    }
  },
  "oneOf": [
    { "required": ["productId"] },
    { "required": ["sku"] }
  ]
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "productId": { "type": "string", "format": "uuid" },
        "variantId": { "type": "string", "format": "uuid", "nullable": true },
        "productName": { "type": "string" },
        "sku": { "type": "string" },
        "totalQuantity": { "type": "integer", "description": "Stock físico total" },
        "reserved": { "type": "integer", "description": "Reservado para pedidos" },
        "available": { "type": "integer", "description": "Disponible para venta" },
        "lowStockThreshold": { "type": "integer" },
        "isLowStock": { "type": "boolean" },
        "locations": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "locationId": { "type": "string" },
              "locationName": { "type": "string" },
              "quantity": { "type": "integer" },
              "reserved": { "type": "integer" }
            }
          }
        }
      }
    },
    "error": { "type": "string" }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const GetStockInput = z.object({
  productId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional(),
  sku: z.string().min(1).max(50).optional(),
}).refine(
  (data) => data.productId || data.sku,
  { message: 'Debe proporcionar productId o sku' }
);

// Validaciones:
// - available = totalQuantity - reserved
// - reserved incluye: StockReservation con status='active' y expiresAt > now
// - isLowStock = available <= lowStockThreshold
// - Si variantId, retorna stock de variante específica
```

---

### 1.5 `list_substitutes`

| Campo | Valor |
|-------|-------|
| **Nombre** | `list_substitutes` |
| **Descripción** | Lista productos sustitutos/alternativos cuando un producto no tiene stock suficiente. |
| **Categoría** | QUERY |
| **Requires Confirmation** | `false` |
| **Idempotency Key** | N/A (lectura) |
| **Eventos Emitidos** | Ninguno |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "productId": {
      "type": "string",
      "format": "uuid",
      "description": "ID del producto original sin stock"
    },
    "requiredQuantity": {
      "type": "integer",
      "minimum": 1,
      "description": "Cantidad que el cliente necesita"
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 10,
      "default": 5,
      "description": "Cantidad de alternativas a mostrar"
    },
    "priceRange": {
      "type": "object",
      "properties": {
        "min": { "type": "number", "minimum": 0 },
        "max": { "type": "number", "minimum": 0 }
      },
      "description": "Rango de precio aceptable"
    }
  },
  "required": ["productId", "requiredQuantity"]
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "originalProduct": {
          "type": "object",
          "properties": {
            "id": { "type": "string" },
            "name": { "type": "string" },
            "price": { "type": "number" },
            "availableStock": { "type": "integer" }
          }
        },
        "substitutes": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": { "type": "string", "format": "uuid" },
              "name": { "type": "string" },
              "sku": { "type": "string" },
              "price": { "type": "number" },
              "priceDifference": { "type": "number", "description": "Diferencia vs original" },
              "availableStock": { "type": "integer" },
              "similarityScore": { "type": "number", "description": "Similitud 0-1" },
              "reason": { "type": "string", "description": "Por qué es buen sustituto" }
            }
          }
        },
        "noSubstitutesReason": { "type": "string", "nullable": true }
      }
    },
    "error": { "type": "string" }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const ListSubstitutesInput = z.object({
  productId: z.string().uuid(),
  requiredQuantity: z.number().int().min(1),
  limit: z.number().int().min(1).max(10).default(5),
  priceRange: z.object({
    min: z.number().min(0).optional(),
    max: z.number().min(0).optional(),
  }).optional(),
});

// Lógica de sustitución:
// 1. Buscar en misma categoría
// 2. Buscar por tags similares (brand, type, size)
// 3. Filtrar por stock >= requiredQuantity
// 4. Ordenar por similarityScore (basado en atributos comunes)
// 5. Si priceRange definido, filtrar por precio
// 6. Calcular priceDifference = substitute.price - original.price
```

---

## 2. Pedidos (Draft → Confirm)

### 2.1 `create_order_draft`

| Campo | Valor |
|-------|-------|
| **Nombre** | `create_order_draft` |
| **Descripción** | Crea un borrador de pedido en memoria (Redis). El carrito se guarda en la sesión hasta confirmación. |
| **Categoría** | MUTATION |
| **Requires Confirmation** | `false` |
| **Idempotency Key** | `create_draft_{sessionId}_{timestamp_minute}` |
| **Eventos Emitidos** | `draft.created` |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "notes": {
      "type": "string",
      "maxLength": 500,
      "description": "Notas iniciales del pedido"
    }
  },
  "required": []
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "draftId": { "type": "string", "description": "ID temporal del draft (sessionId)" },
        "createdAt": { "type": "string", "format": "date-time" },
        "expiresAt": { "type": "string", "format": "date-time", "description": "TTL del draft en Redis" },
        "message": { "type": "string" }
      }
    },
    "error": { "type": "string" },
    "stateTransition": { "type": "string", "enum": ["COLLECTING_ORDER"] }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const CreateOrderDraftInput = z.object({
  notes: z.string().max(500).optional(),
});

// Validaciones:
// - Si ya existe un draft activo, retornarlo (idempotente)
// - TTL del draft: 4 horas
// - Un cliente solo puede tener 1 draft activo por sesión
// - Transiciona FSM a COLLECTING_ORDER si estaba en IDLE
```

---

### 2.2 `add_item_to_draft`

| Campo | Valor |
|-------|-------|
| **Nombre** | `add_item_to_draft` |
| **Descripción** | Agrega un producto al carrito. Valida stock disponible antes de agregar. |
| **Categoría** | MUTATION |
| **Requires Confirmation** | `false` |
| **Idempotency Key** | `add_item_{sessionId}_{productId}_{variantId}_{quantity}_{timestamp_second}` |
| **Eventos Emitidos** | `draft.item_added` |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "productId": {
      "type": "string",
      "format": "uuid",
      "description": "ID del producto a agregar"
    },
    "variantId": {
      "type": "string",
      "format": "uuid",
      "description": "ID de la variante (si aplica)"
    },
    "quantity": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100,
      "description": "Cantidad a agregar"
    },
    "notes": {
      "type": "string",
      "maxLength": 200,
      "description": "Notas para este item (ej: 'sin hielo')"
    }
  },
  "required": ["productId", "quantity"]
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "item": {
          "type": "object",
          "properties": {
            "productId": { "type": "string" },
            "variantId": { "type": "string", "nullable": true },
            "name": { "type": "string" },
            "quantity": { "type": "integer" },
            "unitPrice": { "type": "number" },
            "lineTotal": { "type": "number" }
          }
        },
        "cart": {
          "type": "object",
          "properties": {
            "itemCount": { "type": "integer" },
            "subtotal": { "type": "number" },
            "total": { "type": "number" }
          }
        }
      }
    },
    "error": { "type": "string" },
    "stateTransition": { "type": "string", "enum": ["COLLECTING_ORDER"] }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const AddItemToDraftInput = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().optional(),
  quantity: z.number().int().min(1).max(100),
  notes: z.string().max(200).optional(),
});

// Validaciones:
// 1. Producto existe y status='active'
// 2. Si variantId, la variante existe
// 3. Stock disponible >= cantidad solicitada
// 4. Si item ya existe en carrito, SUMAR cantidad (no reemplazar)
// 5. Validar totalQuantityInCart + newQuantity <= availableStock
// 6. Precio usa variant.price ?? product.price
// 7. Transiciona FSM a COLLECTING_ORDER si estaba en IDLE
```

---

### 2.3 `update_item_qty`

| Campo | Valor |
|-------|-------|
| **Nombre** | `update_item_qty` |
| **Descripción** | Actualiza la cantidad de un item en el carrito. Usar quantity=0 para eliminar. |
| **Categoría** | MUTATION |
| **Requires Confirmation** | `false` |
| **Idempotency Key** | `update_qty_{sessionId}_{productId}_{variantId}_{quantity}` |
| **Eventos Emitidos** | `draft.item_updated` o `draft.item_removed` |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "productId": {
      "type": "string",
      "format": "uuid",
      "description": "ID del producto"
    },
    "variantId": {
      "type": "string",
      "format": "uuid",
      "description": "ID de la variante (si aplica)"
    },
    "quantity": {
      "type": "integer",
      "minimum": 0,
      "maximum": 100,
      "description": "Nueva cantidad (0 para eliminar)"
    }
  },
  "required": ["productId", "quantity"]
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "action": { "type": "string", "enum": ["updated", "removed"] },
        "item": {
          "type": "object",
          "nullable": true,
          "properties": {
            "name": { "type": "string" },
            "quantity": { "type": "integer" },
            "lineTotal": { "type": "number" }
          }
        },
        "cart": {
          "type": "object",
          "properties": {
            "itemCount": { "type": "integer" },
            "subtotal": { "type": "number" },
            "total": { "type": "number" }
          }
        }
      }
    },
    "error": { "type": "string" }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const UpdateItemQtyInput = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().optional(),
  quantity: z.number().int().min(0).max(100),
});

// Validaciones:
// 1. Item debe existir en el carrito
// 2. Si quantity=0, eliminar item del carrito
// 3. Si quantity>0, validar stock disponible
// 4. Recalcular totales del carrito
// 5. Si carrito queda vacío, considerar volver a IDLE
```

---

### 2.4 `remove_item`

| Campo | Valor |
|-------|-------|
| **Nombre** | `remove_item` |
| **Descripción** | Elimina un item del carrito. Wrapper semántico sobre update_item_qty(quantity=0). |
| **Categoría** | MUTATION |
| **Requires Confirmation** | `false` |
| **Idempotency Key** | `remove_item_{sessionId}_{productId}_{variantId}` |
| **Eventos Emitidos** | `draft.item_removed` |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "productId": {
      "type": "string",
      "format": "uuid",
      "description": "ID del producto a eliminar"
    },
    "variantId": {
      "type": "string",
      "format": "uuid",
      "description": "ID de la variante (si aplica)"
    }
  },
  "required": ["productId"]
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "removedItem": {
          "type": "object",
          "properties": {
            "name": { "type": "string" },
            "quantity": { "type": "integer" },
            "lineTotal": { "type": "number" }
          }
        },
        "cart": {
          "type": "object",
          "properties": {
            "itemCount": { "type": "integer" },
            "subtotal": { "type": "number" },
            "total": { "type": "number" }
          }
        }
      }
    },
    "error": { "type": "string" }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const RemoveItemInput = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().optional(),
});

// Validaciones:
// 1. Item debe existir en el carrito
// 2. Eliminar completamente (no reducir cantidad)
// 3. Si carrito queda vacío, transicionar a IDLE
```

---

### 2.5 `set_delivery_details`

| Campo | Valor |
|-------|-------|
| **Nombre** | `set_delivery_details` |
| **Descripción** | Configura detalles de entrega: dirección, método (delivery/pickup), horario preferido. |
| **Categoría** | MUTATION |
| **Requires Confirmation** | `false` |
| **Idempotency Key** | N/A (actualización de estado) |
| **Eventos Emitidos** | `draft.delivery_set` |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "deliveryMethod": {
      "type": "string",
      "enum": ["delivery", "pickup"],
      "description": "Método de entrega"
    },
    "address": {
      "type": "object",
      "properties": {
        "line1": { "type": "string", "minLength": 5, "maxLength": 200 },
        "line2": { "type": "string", "maxLength": 100 },
        "city": { "type": "string", "minLength": 2, "maxLength": 100 },
        "postalCode": { "type": "string", "maxLength": 20 },
        "instructions": { "type": "string", "maxLength": 300 }
      },
      "required": ["line1", "city"]
    },
    "preferredTime": {
      "type": "string",
      "description": "Horario preferido (ej: 'mañana', '14-16hs')"
    },
    "contactPhone": {
      "type": "string",
      "pattern": "^\\+?[0-9]{10,15}$",
      "description": "Teléfono de contacto para la entrega"
    }
  },
  "required": ["deliveryMethod"]
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "deliveryMethod": { "type": "string" },
        "address": { "type": "object" },
        "shippingCost": { "type": "number" },
        "estimatedDelivery": { "type": "string" },
        "cart": {
          "type": "object",
          "properties": {
            "subtotal": { "type": "number" },
            "shipping": { "type": "number" },
            "total": { "type": "number" }
          }
        }
      }
    },
    "error": { "type": "string" }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const SetDeliveryDetailsInput = z.object({
  deliveryMethod: z.enum(['delivery', 'pickup']),
  address: z.object({
    line1: z.string().min(5).max(200),
    line2: z.string().max(100).optional(),
    city: z.string().min(2).max(100),
    postalCode: z.string().max(20).optional(),
    instructions: z.string().max(300).optional(),
  }).optional(),
  preferredTime: z.string().max(50).optional(),
  contactPhone: z.string().regex(/^\+?[0-9]{10,15}$/).optional(),
}).refine(
  (data) => data.deliveryMethod === 'pickup' || data.address,
  { message: 'Dirección requerida para delivery' }
);

// Validaciones:
// 1. Si delivery, dirección es obligatoria
// 2. Calcular costo de envío según zona/distancia
// 3. Validar que zona esté dentro del área de cobertura
// 4. Guardar en cart.shippingAddress
// 5. Recalcular cart.total con shipping
```

---

### 2.6 `summarize_draft`

| Campo | Valor |
|-------|-------|
| **Nombre** | `summarize_draft` |
| **Descripción** | Genera un resumen formateado del carrito actual para mostrar al cliente antes de confirmar. |
| **Categoría** | QUERY |
| **Requires Confirmation** | `false` |
| **Idempotency Key** | N/A (lectura) |
| **Eventos Emitidos** | Ninguno |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "includeStock": {
      "type": "boolean",
      "default": false,
      "description": "Incluir info de stock actual de cada item"
    }
  },
  "required": []
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": { "type": "string" },
              "quantity": { "type": "integer" },
              "unitPrice": { "type": "number" },
              "lineTotal": { "type": "number" },
              "availableStock": { "type": "integer" }
            }
          }
        },
        "subtotal": { "type": "number" },
        "shipping": { "type": "number" },
        "discount": { "type": "number" },
        "total": { "type": "number" },
        "deliveryMethod": { "type": "string", "nullable": true },
        "deliveryAddress": { "type": "string", "nullable": true },
        "notes": { "type": "string", "nullable": true },
        "formattedSummary": { "type": "string", "description": "Texto pre-formateado para enviar" },
        "missingInfo": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Datos faltantes para confirmar"
        }
      }
    },
    "error": { "type": "string" }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const SummarizeDraftInput = z.object({
  includeStock: z.boolean().default(false),
});

// Validaciones:
// 1. Carrito no debe estar vacío
// 2. Verificar stock actual de cada item (puede haber cambiado)
// 3. Si algún item no tiene stock, marcarlo en el resumen
// 4. missingInfo incluye: ['dirección', 'DNI', 'nombre'] según lo faltante
// 5. formattedSummary es un texto listo para enviar al cliente
```

---

### 2.7 `request_confirmation`

| Campo | Valor |
|-------|-------|
| **Nombre** | `request_confirmation` |
| **Descripción** | Solicita confirmación explícita del cliente. Genera el mensaje de confirmación y transiciona a AWAITING_CONFIRMATION. |
| **Categoría** | MUTATION |
| **Requires Confirmation** | `false` |
| **Idempotency Key** | `req_confirm_{sessionId}_{cart_hash}` |
| **Eventos Emitidos** | `draft.confirmation_requested` |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "customMessage": {
      "type": "string",
      "maxLength": 500,
      "description": "Mensaje personalizado a incluir"
    }
  },
  "required": []
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "confirmationId": { "type": "string" },
        "summary": { "type": "string", "description": "Resumen del pedido" },
        "total": { "type": "number" },
        "expiresAt": { "type": "string", "format": "date-time" },
        "requiredResponse": { "type": "string", "description": "Qué debe responder el cliente" }
      }
    },
    "error": { "type": "string" },
    "stateTransition": { "type": "string", "enum": ["AWAITING_CONFIRMATION", "NEEDS_DETAILS"] }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const RequestConfirmationInput = z.object({
  customMessage: z.string().max(500).optional(),
});

// Validaciones:
// 1. Carrito no vacío
// 2. Stock disponible para todos los items
// 3. Datos del cliente completos (DNI, nombre) si es requerido
// 4. Dirección completa si deliveryMethod='delivery'
// 5. Si falta algún dato → transiciona a NEEDS_DETAILS
// 6. Si todo ok → transiciona a AWAITING_CONFIRMATION
// 7. Guarda pendingConfirmation en memoria con TTL
```

---

### 2.8 `confirm_order`

| Campo | Valor |
|-------|-------|
| **Nombre** | `confirm_order` |
| **Descripción** | Confirma el pedido y lo crea en la base de datos. Reserva stock. REQUIERE confirmación explícita del cliente. |
| **Categoría** | MUTATION |
| **Requires Confirmation** | `true` ⚠️ |
| **Idempotency Key** | `confirm_order_{sessionId}_{cart_hash}_{timestamp_minute}` |
| **Eventos Emitidos** | `order.created`, `stock.reserved` |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "confirmationToken": {
      "type": "string",
      "description": "Token de confirmación (generado por request_confirmation)"
    },
    "paymentMethod": {
      "type": "string",
      "enum": ["cash", "transfer", "mercadopago", "debit", "credit"],
      "description": "Método de pago elegido"
    },
    "additionalNotes": {
      "type": "string",
      "maxLength": 500
    }
  },
  "required": []
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "orderId": { "type": "string", "format": "uuid" },
        "orderNumber": { "type": "string", "description": "Número legible (ORD-00001)" },
        "status": { "type": "string" },
        "total": { "type": "number" },
        "estimatedDelivery": { "type": "string" },
        "paymentInstructions": { "type": "string", "nullable": true },
        "confirmationMessage": { "type": "string" }
      }
    },
    "error": { "type": "string" },
    "stateTransition": { "type": "string", "enum": ["DONE", "HANDOFF"] }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const ConfirmOrderInput = z.object({
  confirmationToken: z.string().optional(),
  paymentMethod: z.enum(['cash', 'transfer', 'mercadopago', 'debit', 'credit']).optional(),
  additionalNotes: z.string().max(500).optional(),
});

// Validaciones CRÍTICAS (dentro de transacción):
// 1. Estado FSM debe ser AWAITING_CONFIRMATION
// 2. Carrito no vacío
// 3. Re-validar stock de TODOS los items (puede haber cambiado)
// 4. Si algún item sin stock → ROLLBACK + error específico
// 5. Crear Order en DB con status='pending'
// 6. Crear OrderItems con precios actuales
// 7. Crear StockReservation para cada item (expiresAt=24h)
// 8. Decrementar stockItem.reserved (no quantity)
// 9. Generar orderNumber secuencial por workspace
// 10. Limpiar carrito de Redis
// 11. Transicionar FSM a DONE
// 12. Si error → transicionar a HANDOFF
```

---

## 3. Modificación/Cancelación

### 3.1 `modify_order_if_not_processed`

| Campo | Valor |
|-------|-------|
| **Nombre** | `modify_order_if_not_processed` |
| **Descripción** | Modifica un pedido existente SOLO si no está procesado. Si está procesado, retorna error y sugiere handoff. |
| **Categoría** | MUTATION |
| **Requires Confirmation** | `true` ⚠️ |
| **Idempotency Key** | `modify_order_{orderId}_{action}_{productId}_{timestamp_minute}` |
| **Eventos Emitidos** | `order.modified`, `stock.adjusted` |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "orderId": {
      "type": "string",
      "format": "uuid"
    },
    "orderNumber": {
      "type": "string",
      "description": "Alternativo a orderId"
    },
    "action": {
      "type": "string",
      "enum": ["add_item", "remove_item", "update_quantity", "update_notes"],
      "description": "Tipo de modificación"
    },
    "productId": {
      "type": "string",
      "format": "uuid",
      "description": "Requerido para add/remove/update_quantity"
    },
    "variantId": {
      "type": "string",
      "format": "uuid"
    },
    "quantity": {
      "type": "integer",
      "minimum": 0
    },
    "notes": {
      "type": "string",
      "maxLength": 500
    }
  },
  "required": ["action"],
  "oneOf": [
    { "required": ["orderId"] },
    { "required": ["orderNumber"] }
  ]
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "orderId": { "type": "string" },
        "orderNumber": { "type": "string" },
        "previousTotal": { "type": "number" },
        "newTotal": { "type": "number" },
        "modification": {
          "type": "object",
          "properties": {
            "action": { "type": "string" },
            "item": { "type": "string" },
            "details": { "type": "string" }
          }
        }
      }
    },
    "error": { "type": "string" },
    "requiresHandoff": { "type": "boolean" },
    "handoffReason": { "type": "string" }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const ModifyOrderInput = z.object({
  orderId: z.string().uuid().optional(),
  orderNumber: z.string().optional(),
  action: z.enum(['add_item', 'remove_item', 'update_quantity', 'update_notes']),
  productId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional(),
  quantity: z.number().int().min(0).optional(),
  notes: z.string().max(500).optional(),
}).refine(
  (data) => data.orderId || data.orderNumber,
  { message: 'Debe proporcionar orderId o orderNumber' }
).refine(
  (data) => {
    if (['add_item', 'remove_item', 'update_quantity'].includes(data.action)) {
      return !!data.productId;
    }
    return true;
  },
  { message: 'productId requerido para esta acción' }
);

// Validaciones CRÍTICAS:
// 1. Orden debe existir
// 2. VERIFICAR STATUS:
//    - Si status in PROCESSED_STATUSES → requiresHandoff=true, NO modificar
//    - Si status in MODIFIABLE_STATUSES → permitir modificación
// 3. Si add_item: validar stock disponible
// 4. Si remove_item: liberar reserva de stock
// 5. Si update_quantity:
//    - Si aumenta: validar stock adicional
//    - Si disminuye: liberar reserva parcial
// 6. Recalcular totales de la orden
// 7. Registrar en audit log
```

---

### 3.2 `cancel_order_if_not_processed`

| Campo | Valor |
|-------|-------|
| **Nombre** | `cancel_order_if_not_processed` |
| **Descripción** | Cancela un pedido SOLO si no está procesado. Libera stock reservado. |
| **Categoría** | MUTATION |
| **Requires Confirmation** | `true` ⚠️ |
| **Idempotency Key** | `cancel_order_{orderId}_{timestamp_minute}` |
| **Eventos Emitidos** | `order.cancelled`, `stock.released` |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "orderId": {
      "type": "string",
      "format": "uuid"
    },
    "orderNumber": {
      "type": "string"
    },
    "reason": {
      "type": "string",
      "minLength": 3,
      "maxLength": 500,
      "description": "Razón de la cancelación"
    }
  },
  "required": ["reason"],
  "oneOf": [
    { "required": ["orderId"] },
    { "required": ["orderNumber"] }
  ]
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "orderId": { "type": "string" },
        "orderNumber": { "type": "string" },
        "previousStatus": { "type": "string" },
        "newStatus": { "type": "string", "enum": ["cancelled"] },
        "stockReleased": { "type": "boolean" },
        "refundRequired": { "type": "boolean" },
        "refundAmount": { "type": "number" }
      }
    },
    "error": { "type": "string" },
    "requiresHandoff": { "type": "boolean" },
    "handoffReason": { "type": "string" }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const CancelOrderInput = z.object({
  orderId: z.string().uuid().optional(),
  orderNumber: z.string().optional(),
  reason: z.string().min(3).max(500),
}).refine(
  (data) => data.orderId || data.orderNumber,
  { message: 'Debe proporcionar orderId o orderNumber' }
);

// Validaciones CRÍTICAS:
// 1. Orden debe existir y pertenecer al cliente
// 2. VERIFICAR STATUS:
//    - Si status in PROCESSED_STATUSES → requiresHandoff=true
//    - Si status in MODIFIABLE_STATUSES → permitir cancelación
// 3. Dentro de transacción:
//    a. Actualizar order.status = 'cancelled'
//    b. Guardar order.cancellationReason
//    c. Para cada OrderItem:
//       - Obtener StockReservation
//       - Decrementar stockItem.reserved
//       - Marcar reserva como 'released'
// 4. Si había pagos: refundRequired=true
// 5. Registrar en audit log
```

---

### 3.3 `request_handoff`

| Campo | Valor |
|-------|-------|
| **Nombre** | `request_handoff` |
| **Descripción** | Solicita transferencia de la conversación a un operador humano. Desactiva el agente para esta sesión. |
| **Categoría** | SYSTEM |
| **Requires Confirmation** | `false` |
| **Idempotency Key** | `handoff_{sessionId}_{timestamp_minute}` |
| **Eventos Emitidos** | `session.handoff_requested` |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "reason": {
      "type": "string",
      "minLength": 3,
      "maxLength": 500,
      "description": "Razón del handoff"
    },
    "triggerType": {
      "type": "string",
      "enum": ["consecutive_errors", "negative_sentiment", "order_already_processed", "customer_request", "agent_limitation"],
      "description": "Tipo de trigger que causó el handoff"
    },
    "context": {
      "type": "object",
      "description": "Contexto adicional para el operador",
      "properties": {
        "lastError": { "type": "string" },
        "customerMessage": { "type": "string" },
        "suggestedAction": { "type": "string" }
      }
    }
  },
  "required": ["reason", "triggerType"]
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "handoffId": { "type": "string", "format": "uuid" },
        "sessionId": { "type": "string" },
        "status": { "type": "string", "enum": ["pending"] },
        "estimatedWaitTime": { "type": "string" },
        "messageToCustomer": { "type": "string" }
      }
    },
    "error": { "type": "string" },
    "stateTransition": { "type": "string", "enum": ["HANDOFF"] }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const RequestHandoffInput = z.object({
  reason: z.string().min(3).max(500),
  triggerType: z.enum([
    'consecutive_errors',
    'negative_sentiment',
    'order_already_processed',
    'customer_request',
    'agent_limitation'
  ]),
  context: z.object({
    lastError: z.string().optional(),
    customerMessage: z.string().optional(),
    suggestedAction: z.string().optional(),
  }).optional(),
});

// Acciones:
// 1. Actualizar AgentSession.agentActive = false
// 2. Actualizar AgentSession.currentState = 'HANDOFF'
// 3. Crear registro HandoffRequest en DB
// 4. Emitir WebSocket event para notificar Dashboard
// 5. Retornar mensaje pre-formateado para el cliente
// 6. NO se puede revertir desde el agente
```

---

## 4. Clientes

### 4.1 `get_or_create_customer_by_phone`

| Campo | Valor |
|-------|-------|
| **Nombre** | `get_or_create_customer_by_phone` |
| **Descripción** | Obtiene o crea un cliente por su número de teléfono. Fundamental para identificar al cliente en cada conversación. |
| **Categoría** | MUTATION |
| **Requires Confirmation** | `false` |
| **Idempotency Key** | `customer_{workspaceId}_{phone}` |
| **Eventos Emitidos** | `customer.created` (si es nuevo) |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "phone": {
      "type": "string",
      "pattern": "^\\+?[0-9]{10,15}$",
      "description": "Número de teléfono del cliente"
    }
  },
  "required": ["phone"]
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "customerId": { "type": "string", "format": "uuid" },
        "phone": { "type": "string" },
        "firstName": { "type": "string", "nullable": true },
        "lastName": { "type": "string", "nullable": true },
        "dni": { "type": "string", "nullable": true },
        "email": { "type": "string", "nullable": true },
        "isNew": { "type": "boolean" },
        "needsRegistration": { "type": "boolean", "description": "True si falta DNI o nombre" },
        "totalOrders": { "type": "integer" },
        "totalSpent": { "type": "number" },
        "lastOrderDate": { "type": "string", "format": "date-time", "nullable": true }
      }
    },
    "error": { "type": "string" }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const GetOrCreateCustomerInput = z.object({
  phone: z.string().regex(/^\+?[0-9]{10,15}$/),
});

// Validaciones:
// 1. Normalizar teléfono (remover espacios, agregar código país si falta)
// 2. Buscar por UNIQUE(workspaceId, phone)
// 3. Si existe → retornar datos completos
// 4. Si no existe → crear con status='active', retornar isNew=true
// 5. needsRegistration = !firstName || !dni
// 6. Incluir estadísticas de órdenes
```

---

### 4.2 `set_customer_identity`

| Campo | Valor |
|-------|-------|
| **Nombre** | `set_customer_identity` |
| **Descripción** | Establece o actualiza DNI y nombre completo del cliente. Necesario para facturación. |
| **Categoría** | MUTATION |
| **Requires Confirmation** | `false` |
| **Idempotency Key** | `set_identity_{customerId}_{dni}` |
| **Eventos Emitidos** | `customer.identity_updated` |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "dni": {
      "type": "string",
      "pattern": "^[0-9]{7,8}$",
      "description": "DNI del cliente (7-8 dígitos)"
    },
    "firstName": {
      "type": "string",
      "minLength": 2,
      "maxLength": 50,
      "description": "Nombre del cliente"
    },
    "lastName": {
      "type": "string",
      "minLength": 2,
      "maxLength": 50,
      "description": "Apellido del cliente"
    },
    "email": {
      "type": "string",
      "format": "email",
      "description": "Email del cliente (opcional)"
    }
  },
  "required": []
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "customerId": { "type": "string" },
        "dni": { "type": "string" },
        "fullName": { "type": "string" },
        "email": { "type": "string", "nullable": true },
        "isComplete": { "type": "boolean", "description": "True si tiene DNI y nombre" }
      }
    },
    "error": { "type": "string" }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const SetCustomerIdentityInput = z.object({
  dni: z.string().regex(/^[0-9]{7,8}$/).optional(),
  firstName: z.string().min(2).max(50).optional(),
  lastName: z.string().min(2).max(50).optional(),
  email: z.string().email().optional(),
}).refine(
  (data) => data.dni || data.firstName || data.lastName || data.email,
  { message: 'Debe proporcionar al menos un campo' }
);

// Validaciones:
// 1. Al menos un campo debe ser proporcionado
// 2. DNI: validar formato argentino (7-8 dígitos)
// 3. Si DNI ya existe para OTRO cliente → error
// 4. Normalizar nombre (capitalizar)
// 5. Email: validar formato, normalizar lowercase
// 6. isComplete = dni && firstName
```

---

### 4.3 `get_customer_notes`

| Campo | Valor |
|-------|-------|
| **Nombre** | `get_customer_notes` |
| **Descripción** | Obtiene notas y preferencias del cliente guardadas por el comercio (alergias, preferencias de entrega, etc.). |
| **Categoría** | QUERY |
| **Requires Confirmation** | `false` |
| **Idempotency Key** | N/A (lectura) |
| **Eventos Emitidos** | Ninguno |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {},
  "required": []
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "customerId": { "type": "string" },
        "notes": { "type": "string", "nullable": true },
        "preferences": {
          "type": "object",
          "properties": {
            "allergies": { "type": "array", "items": { "type": "string" } },
            "dietaryRestrictions": { "type": "array", "items": { "type": "string" } },
            "deliveryPreferences": { "type": "string" },
            "favoriteProducts": { "type": "array", "items": { "type": "string" } }
          }
        },
        "tags": { "type": "array", "items": { "type": "string" } },
        "lastUpdated": { "type": "string", "format": "date-time" }
      }
    },
    "error": { "type": "string" }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const GetCustomerNotesInput = z.object({});

// El customerId se obtiene del contexto de la sesión

// Validaciones:
// 1. Obtener notas de customer.notes
// 2. Obtener preferences de customer.metadata.preferences
// 3. Obtener tags de customer.tags
// 4. Si no hay notas, retornar null (no error)
```

---

## 5. Deuda

### 5.1 `get_customer_balance`

| Campo | Valor |
|-------|-------|
| **Nombre** | `get_customer_balance` |
| **Descripción** | Obtiene el balance (deuda) actual del cliente. Suma de órdenes impagas menos pagos recibidos. |
| **Categoría** | QUERY |
| **Requires Confirmation** | `false` |
| **Idempotency Key** | N/A (lectura) |
| **Eventos Emitidos** | Ninguno |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "includeDetails": {
      "type": "boolean",
      "default": false,
      "description": "Incluir detalle de órdenes impagas"
    }
  },
  "required": []
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "customerId": { "type": "string" },
        "customerName": { "type": "string" },
        "totalDebt": { "type": "number" },
        "currency": { "type": "string", "default": "ARS" },
        "unpaidOrders": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "orderId": { "type": "string" },
              "orderNumber": { "type": "string" },
              "orderDate": { "type": "string", "format": "date-time" },
              "total": { "type": "number" },
              "paid": { "type": "number" },
              "pending": { "type": "number" }
            }
          }
        },
        "lastPaymentDate": { "type": "string", "format": "date-time", "nullable": true },
        "daysSinceLastPayment": { "type": "integer", "nullable": true }
      }
    },
    "error": { "type": "string" }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const GetCustomerBalanceInput = z.object({
  includeDetails: z.boolean().default(false),
});

// Cálculo de deuda:
// 1. Obtener órdenes del cliente con status NOT IN ('cancelled', 'draft')
// 2. Para cada orden: pending = total - SUM(payments WHERE status='completed')
// 3. totalDebt = SUM(pending) de todas las órdenes
// 4. Si includeDetails, listar órdenes con pending > 0
// 5. Calcular daysSinceLastPayment
```

---

### 5.2 `apply_payment_to_balance`

| Campo | Valor |
|-------|-------|
| **Nombre** | `apply_payment_to_balance` |
| **Descripción** | Registra un pago contra el balance del cliente. Puede aplicar a orden específica o al balance general. |
| **Categoría** | MUTATION |
| **Requires Confirmation** | `true` ⚠️ |
| **Idempotency Key** | `payment_{customerId}_{amount}_{reference}_{timestamp_minute}` |
| **Eventos Emitidos** | `payment.received`, `debt.reduced` |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "amount": {
      "type": "number",
      "minimum": 0.01,
      "description": "Monto del pago"
    },
    "method": {
      "type": "string",
      "enum": ["cash", "transfer", "mercadopago", "debit", "credit"],
      "description": "Método de pago"
    },
    "reference": {
      "type": "string",
      "maxLength": 100,
      "description": "Referencia/comprobante del pago"
    },
    "orderId": {
      "type": "string",
      "format": "uuid",
      "description": "Aplicar a orden específica (opcional)"
    },
    "notes": {
      "type": "string",
      "maxLength": 200
    }
  },
  "required": ["amount", "method"]
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "paymentId": { "type": "string", "format": "uuid" },
        "amount": { "type": "number" },
        "appliedTo": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "orderId": { "type": "string" },
              "orderNumber": { "type": "string" },
              "amountApplied": { "type": "number" }
            }
          }
        },
        "previousBalance": { "type": "number" },
        "newBalance": { "type": "number" },
        "receiptNumber": { "type": "string" }
      }
    },
    "error": { "type": "string" }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const ApplyPaymentInput = z.object({
  amount: z.number().min(0.01),
  method: z.enum(['cash', 'transfer', 'mercadopago', 'debit', 'credit']),
  reference: z.string().max(100).optional(),
  orderId: z.string().uuid().optional(),
  notes: z.string().max(200).optional(),
});

// Lógica de aplicación:
// 1. Si orderId especificado → aplicar solo a esa orden
// 2. Si no → aplicar a órdenes más antiguas primero (FIFO)
// 3. Dentro de transacción:
//    a. Crear Payment record
//    b. Actualizar order.paidAmount para cada orden afectada
//    c. Si order.paidAmount >= order.total → marcar como paid
// 4. Si amount > totalDebt → guardar como crédito a favor
// 5. Generar receiptNumber
```

---

### 5.3 `schedule_debt_reminder`

| Campo | Valor |
|-------|-------|
| **Nombre** | `schedule_debt_reminder` |
| **Descripción** | Programa un recordatorio de deuda para ser enviado al cliente. |
| **Categoría** | MUTATION |
| **Requires Confirmation** | `false` |
| **Idempotency Key** | `reminder_{customerId}_{scheduleDate}` |
| **Eventos Emitidos** | `reminder.scheduled` |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "scheduleDate": {
      "type": "string",
      "format": "date-time",
      "description": "Fecha y hora para enviar el recordatorio"
    },
    "message": {
      "type": "string",
      "maxLength": 500,
      "description": "Mensaje personalizado (opcional)"
    },
    "includePaymentLink": {
      "type": "boolean",
      "default": true,
      "description": "Incluir link de pago en el mensaje"
    }
  },
  "required": ["scheduleDate"]
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "reminderId": { "type": "string", "format": "uuid" },
        "scheduledFor": { "type": "string", "format": "date-time" },
        "debtAmount": { "type": "number" },
        "status": { "type": "string", "enum": ["scheduled"] }
      }
    },
    "error": { "type": "string" }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const ScheduleDebtReminderInput = z.object({
  scheduleDate: z.string().datetime(),
  message: z.string().max(500).optional(),
  includePaymentLink: z.boolean().default(true),
});

// Validaciones:
// 1. scheduleDate debe ser en el futuro
// 2. Cliente debe tener deuda > 0
// 3. No duplicar recordatorios para misma fecha
// 4. Crear job en BullMQ con delay
// 5. Si includePaymentLink, generar link de MercadoPago
```

---

## 6. Pagos/Comprobantes

### 6.1 `create_mercadopago_payment_link`

| Campo | Valor |
|-------|-------|
| **Nombre** | `create_mercadopago_payment_link` |
| **Descripción** | Genera un link de pago de MercadoPago para un monto o orden específica. |
| **Categoría** | MUTATION |
| **Requires Confirmation** | `false` |
| **Idempotency Key** | `mp_link_{orderId}_{amount}_{timestamp_hour}` |
| **Eventos Emitidos** | `payment_link.created` |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "orderId": {
      "type": "string",
      "format": "uuid",
      "description": "Orden a pagar (opcional)"
    },
    "amount": {
      "type": "number",
      "minimum": 1,
      "description": "Monto a cobrar (si no hay orderId)"
    },
    "description": {
      "type": "string",
      "maxLength": 200,
      "description": "Descripción del pago"
    },
    "expirationMinutes": {
      "type": "integer",
      "minimum": 10,
      "maximum": 1440,
      "default": 60,
      "description": "Minutos hasta expiración del link"
    }
  },
  "oneOf": [
    { "required": ["orderId"] },
    { "required": ["amount"] }
  ]
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "paymentLinkId": { "type": "string" },
        "paymentUrl": { "type": "string", "format": "uri" },
        "amount": { "type": "number" },
        "description": { "type": "string" },
        "expiresAt": { "type": "string", "format": "date-time" },
        "qrCode": { "type": "string", "description": "Base64 del QR" }
      }
    },
    "error": { "type": "string" }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const CreateMercadoPagoLinkInput = z.object({
  orderId: z.string().uuid().optional(),
  amount: z.number().min(1).optional(),
  description: z.string().max(200).optional(),
  expirationMinutes: z.number().int().min(10).max(1440).default(60),
}).refine(
  (data) => data.orderId || data.amount,
  { message: 'Debe proporcionar orderId o amount' }
);

// Validaciones:
// 1. Workspace debe tener MercadoPago configurado
// 2. Si orderId: obtener monto pendiente de la orden
// 3. Llamar a MercadoPago API para crear preferencia
// 4. Guardar referencia en PaymentIntent
// 5. Retornar URL y QR para el cliente
```

---

### 6.2 `ingest_receipt`

| Campo | Valor |
|-------|-------|
| **Nombre** | `ingest_receipt` |
| **Descripción** | Procesa un comprobante de pago enviado por el cliente (imagen o PDF). |
| **Categoría** | MUTATION |
| **Requires Confirmation** | `false` |
| **Idempotency Key** | `receipt_{fileRef}` |
| **Eventos Emitidos** | `receipt.ingested` |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "fileRef": {
      "type": "string",
      "description": "Referencia al archivo (URL o ID de WhatsApp media)"
    },
    "fileType": {
      "type": "string",
      "enum": ["image", "pdf"],
      "description": "Tipo de archivo"
    },
    "suggestedOrderId": {
      "type": "string",
      "format": "uuid",
      "description": "Orden sugerida para asociar (opcional)"
    }
  },
  "required": ["fileRef", "fileType"]
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "receiptId": { "type": "string", "format": "uuid" },
        "status": { "type": "string", "enum": ["pending_analysis", "analyzed", "failed"] },
        "fileUrl": { "type": "string" },
        "needsOrderReference": { "type": "boolean" },
        "message": { "type": "string" }
      }
    },
    "error": { "type": "string" }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const IngestReceiptInput = z.object({
  fileRef: z.string().min(1),
  fileType: z.enum(['image', 'pdf']),
  suggestedOrderId: z.string().uuid().optional(),
});

// Proceso:
// 1. Descargar archivo de WhatsApp/URL
// 2. Guardar en storage (S3/local)
// 3. Crear registro Receipt con status='pending_analysis'
// 4. Encolar job para OCR/análisis
// 5. Si suggestedOrderId, pre-asociar
// 6. Retornar status y si necesita referencia de orden
```

---

### 6.3 `parse_receipt_amount`

| Campo | Valor |
|-------|-------|
| **Nombre** | `parse_receipt_amount` |
| **Descripción** | Extrae el monto de un comprobante previamente ingestado usando OCR. |
| **Categoría** | QUERY |
| **Requires Confirmation** | `false` |
| **Idempotency Key** | N/A (lectura) |
| **Eventos Emitidos** | `receipt.parsed` |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "receiptId": {
      "type": "string",
      "format": "uuid",
      "description": "ID del comprobante ingestado"
    }
  },
  "required": ["receiptId"]
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "receiptId": { "type": "string" },
        "amount": { "type": "number", "nullable": true },
        "currency": { "type": "string" },
        "date": { "type": "string", "format": "date", "nullable": true },
        "reference": { "type": "string", "nullable": true },
        "confidence": { "type": "number", "description": "Confianza del OCR 0-1" },
        "rawText": { "type": "string" },
        "needsManualReview": { "type": "boolean" }
      }
    },
    "error": { "type": "string" }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const ParseReceiptAmountInput = z.object({
  receiptId: z.string().uuid(),
});

// Proceso:
// 1. Obtener receipt de DB
// 2. Si ya parseado, retornar cached
// 3. Si no, ejecutar OCR (Tesseract/Cloud Vision)
// 4. Extraer: monto, fecha, referencia
// 5. confidence < 0.7 → needsManualReview=true
// 6. Actualizar receipt con datos parseados
```

---

### 6.4 `attach_receipt_to_order`

| Campo | Valor |
|-------|-------|
| **Nombre** | `attach_receipt_to_order` |
| **Descripción** | Asocia un comprobante parseado a una orden y registra el pago. |
| **Categoría** | MUTATION |
| **Requires Confirmation** | `true` ⚠️ |
| **Idempotency Key** | `attach_receipt_{receiptId}_{orderId}` |
| **Eventos Emitidos** | `receipt.attached`, `payment.received` |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "receiptId": {
      "type": "string",
      "format": "uuid",
      "description": "ID del comprobante"
    },
    "orderId": {
      "type": "string",
      "format": "uuid",
      "description": "ID de la orden"
    },
    "orderNumber": {
      "type": "string",
      "description": "Alternativo a orderId"
    },
    "confirmedAmount": {
      "type": "number",
      "description": "Monto confirmado (si difiere del parseado)"
    }
  },
  "required": ["receiptId"],
  "oneOf": [
    { "required": ["orderId"] },
    { "required": ["orderNumber"] }
  ]
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "receiptId": { "type": "string" },
        "orderId": { "type": "string" },
        "paymentId": { "type": "string" },
        "amount": { "type": "number" },
        "orderPreviousBalance": { "type": "number" },
        "orderNewBalance": { "type": "number" },
        "orderFullyPaid": { "type": "boolean" }
      }
    },
    "error": { "type": "string" }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const AttachReceiptToOrderInput = z.object({
  receiptId: z.string().uuid(),
  orderId: z.string().uuid().optional(),
  orderNumber: z.string().optional(),
  confirmedAmount: z.number().min(0.01).optional(),
}).refine(
  (data) => data.orderId || data.orderNumber,
  { message: 'Debe proporcionar orderId o orderNumber' }
);

// Validaciones:
// 1. Receipt existe y no está ya asociado
// 2. Orden existe y pertenece al cliente
// 3. Usar confirmedAmount si difiere del parseado
// 4. Crear Payment con method='transfer', referencia del receipt
// 5. Actualizar order.paidAmount
// 6. Marcar receipt como 'attached'
```

---

### 6.5 `ask_receipt_order_reference`

| Campo | Valor |
|-------|-------|
| **Nombre** | `ask_receipt_order_reference` |
| **Descripción** | Solicita al cliente que indique a qué orden corresponde un comprobante cuando no es claro. |
| **Categoría** | QUERY |
| **Requires Confirmation** | `false` |
| **Idempotency Key** | N/A |
| **Eventos Emitidos** | Ninguno |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "receiptId": {
      "type": "string",
      "format": "uuid",
      "description": "ID del comprobante"
    }
  },
  "required": ["receiptId"]
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "receiptId": { "type": "string" },
        "parsedAmount": { "type": "number" },
        "possibleOrders": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "orderId": { "type": "string" },
              "orderNumber": { "type": "string" },
              "orderDate": { "type": "string" },
              "total": { "type": "number" },
              "pending": { "type": "number" },
              "matchScore": { "type": "number", "description": "Coincidencia con monto 0-1" }
            }
          }
        },
        "questionForCustomer": { "type": "string" }
      }
    },
    "error": { "type": "string" }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const AskReceiptOrderReferenceInput = z.object({
  receiptId: z.string().uuid(),
});

// Proceso:
// 1. Obtener monto parseado del receipt
// 2. Buscar órdenes del cliente con pending > 0
// 3. Calcular matchScore = 1 - abs(order.pending - parsedAmount) / order.pending
// 4. Ordenar por matchScore descendente
// 5. Generar pregunta formateada para el cliente
```

---

## 7. Mi Perfil / Config

### 7.1 `get_business_profile`

| Campo | Valor |
|-------|-------|
| **Nombre** | `get_business_profile` |
| **Descripción** | Obtiene información del comercio: nombre, teléfono, dirección, horarios, métodos de pago. |
| **Categoría** | QUERY |
| **Requires Confirmation** | `false` |
| **Idempotency Key** | N/A (lectura) |
| **Eventos Emitidos** | Ninguno |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {},
  "required": []
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "name": { "type": "string" },
        "phone": { "type": "string" },
        "address": { "type": "string" },
        "city": { "type": "string" },
        "schedule": {
          "type": "object",
          "properties": {
            "monday": { "type": "string" },
            "tuesday": { "type": "string" },
            "wednesday": { "type": "string" },
            "thursday": { "type": "string" },
            "friday": { "type": "string" },
            "saturday": { "type": "string" },
            "sunday": { "type": "string" }
          }
        },
        "deliveryInfo": {
          "type": "object",
          "properties": {
            "available": { "type": "boolean" },
            "minOrder": { "type": "number" },
            "freeDeliveryOver": { "type": "number" },
            "deliveryCost": { "type": "number" },
            "zones": { "type": "array", "items": { "type": "string" } }
          }
        },
        "paymentMethods": {
          "type": "array",
          "items": { "type": "string" }
        },
        "socialMedia": {
          "type": "object",
          "properties": {
            "instagram": { "type": "string" },
            "facebook": { "type": "string" }
          }
        }
      }
    },
    "error": { "type": "string" }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const GetBusinessProfileInput = z.object({});

// Obtiene datos de:
// 1. Workspace.name, Workspace.phone
// 2. Workspace.settings.address, schedule, delivery, etc.
// 3. Formatea horarios de manera legible
```

---

### 7.2 `get_business_policies_text`

| Campo | Valor |
|-------|-------|
| **Nombre** | `get_business_policies_text` |
| **Descripción** | Obtiene textos de políticas del comercio (devoluciones, cambios, garantías). |
| **Categoría** | QUERY |
| **Requires Confirmation** | `false` |
| **Idempotency Key** | N/A (lectura) |
| **Eventos Emitidos** | Ninguno |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "policyType": {
      "type": "string",
      "enum": ["returns", "exchanges", "warranty", "shipping", "payments", "all"],
      "default": "all",
      "description": "Tipo de política a consultar"
    }
  },
  "required": []
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "policies": {
          "type": "object",
          "properties": {
            "returns": { "type": "string", "nullable": true },
            "exchanges": { "type": "string", "nullable": true },
            "warranty": { "type": "string", "nullable": true },
            "shipping": { "type": "string", "nullable": true },
            "payments": { "type": "string", "nullable": true }
          }
        },
        "customInstructions": { "type": "string", "nullable": true },
        "lastUpdated": { "type": "string", "format": "date-time" }
      }
    },
    "error": { "type": "string" }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const GetBusinessPoliciesInput = z.object({
  policyType: z.enum(['returns', 'exchanges', 'warranty', 'shipping', 'payments', 'all']).default('all'),
});

// Obtiene de Workspace.settings.policies
// Si policyType != 'all', filtra solo esa política
```

---

## 8. Quick Action (Owner Dashboard)

### 8.1 `quick_action_execute`

| Campo | Valor |
|-------|-------|
| **Nombre** | `quick_action_execute` |
| **Descripción** | Ejecuta un comando rápido enviado por el owner desde el dashboard. Corre en sandbox con políticas restrictivas. |
| **Categoría** | SYSTEM |
| **Requires Confirmation** | `true` ⚠️ (según comando) |
| **Idempotency Key** | `quick_action_{sessionId}_{commandHash}_{timestamp_minute}` |
| **Eventos Emitidos** | `quick_action.executed` |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "commandText": {
      "type": "string",
      "minLength": 1,
      "maxLength": 500,
      "description": "Comando en lenguaje natural del owner"
    },
    "targetCustomerId": {
      "type": "string",
      "format": "uuid",
      "description": "Cliente objetivo (si aplica)"
    },
    "targetOrderId": {
      "type": "string",
      "format": "uuid",
      "description": "Orden objetivo (si aplica)"
    }
  },
  "required": ["commandText"]
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "actionId": { "type": "string", "format": "uuid" },
        "interpretedCommand": { "type": "string" },
        "actionsPerformed": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "tool": { "type": "string" },
              "input": { "type": "object" },
              "result": { "type": "string" }
            }
          }
        },
        "messageToCustomer": { "type": "string", "nullable": true },
        "requiresFollowUp": { "type": "boolean" }
      }
    },
    "error": { "type": "string" },
    "blockedReason": { "type": "string", "nullable": true }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const QuickActionExecuteInput = z.object({
  commandText: z.string().min(1).max(500),
  targetCustomerId: z.string().uuid().optional(),
  targetOrderId: z.string().uuid().optional(),
});

// POLÍTICAS DE SANDBOX:
//
// PERMITIDO:
// - Agregar/modificar items al carrito del cliente
// - Aplicar descuentos (hasta 50%)
// - Enviar mensaje al cliente
// - Confirmar pedido (si cliente ya confirmó)
// - Cancelar pedido (si no procesado)
// - Aplicar pago
//
// BLOQUEADO:
// - Modificar precios de productos
// - Eliminar productos del catálogo
// - Modificar datos sensibles del cliente (DNI)
// - Acceder a otros workspaces
// - Ejecutar código arbitrario
//
// REQUIERE CONFIRMACIÓN:
// - Descuentos > 20%
// - Cancelaciones
// - Modificaciones de pedidos procesados

// Proceso:
// 1. Parsear commandText con LLM
// 2. Identificar herramienta(s) necesaria(s)
// 3. Validar contra políticas de sandbox
// 4. Si bloqueado → retornar blockedReason
// 5. Si requiere confirmación → solicitar
// 6. Ejecutar herramientas en secuencia
// 7. Generar mensaje para el cliente si aplica
```

---

## 9. PDF

### 9.1 `generate_catalog_pdf`

| Campo | Valor |
|-------|-------|
| **Nombre** | `generate_catalog_pdf` |
| **Descripción** | Genera un PDF del catálogo de productos con filtros opcionales. |
| **Categoría** | MUTATION |
| **Requires Confirmation** | `false` |
| **Idempotency Key** | `catalog_pdf_{workspaceId}_{filtersHash}_{timestamp_hour}` |
| **Eventos Emitidos** | `catalog.pdf_generated` |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "filters": {
      "type": "object",
      "properties": {
        "categories": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Filtrar por categorías"
        },
        "inStockOnly": {
          "type": "boolean",
          "default": true,
          "description": "Solo productos con stock"
        },
        "priceRange": {
          "type": "object",
          "properties": {
            "min": { "type": "number" },
            "max": { "type": "number" }
          }
        }
      }
    },
    "includeImages": {
      "type": "boolean",
      "default": true,
      "description": "Incluir imágenes de productos"
    },
    "includePrices": {
      "type": "boolean",
      "default": true,
      "description": "Incluir precios en el catálogo"
    },
    "sortBy": {
      "type": "string",
      "enum": ["name", "category", "price"],
      "default": "category"
    }
  },
  "required": []
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "pdfId": { "type": "string", "format": "uuid" },
        "fileUrl": { "type": "string", "format": "uri" },
        "fileSize": { "type": "integer", "description": "Tamaño en bytes" },
        "pageCount": { "type": "integer" },
        "productCount": { "type": "integer" },
        "expiresAt": { "type": "string", "format": "date-time" },
        "generatedAt": { "type": "string", "format": "date-time" }
      }
    },
    "error": { "type": "string" }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const GenerateCatalogPdfInput = z.object({
  filters: z.object({
    categories: z.array(z.string()).optional(),
    inStockOnly: z.boolean().default(true),
    priceRange: z.object({
      min: z.number().min(0).optional(),
      max: z.number().min(0).optional(),
    }).optional(),
  }).optional(),
  includeImages: z.boolean().default(true),
  includePrices: z.boolean().default(true),
  sortBy: z.enum(['name', 'category', 'price']).default('category'),
});

// Proceso:
// 1. Consultar productos con filtros
// 2. Agrupar por categoría si sortBy='category'
// 3. Generar PDF con librería (puppeteer/pdfkit)
// 4. Subir a storage (S3/local)
// 5. Retornar URL con TTL (24h)
```

---

### 9.2 `send_pdf_whatsapp`

| Campo | Valor |
|-------|-------|
| **Nombre** | `send_pdf_whatsapp` |
| **Descripción** | Envía un archivo PDF al cliente por WhatsApp. |
| **Categoría** | MUTATION |
| **Requires Confirmation** | `false` |
| **Idempotency Key** | `send_pdf_{fileRef}_{customerPhone}_{timestamp_minute}` |
| **Eventos Emitidos** | `message.pdf_sent` |

**Input JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "fileRef": {
      "type": "string",
      "description": "URL o ID del archivo PDF"
    },
    "caption": {
      "type": "string",
      "maxLength": 200,
      "description": "Mensaje que acompaña el PDF"
    },
    "fileName": {
      "type": "string",
      "maxLength": 100,
      "description": "Nombre del archivo a mostrar"
    }
  },
  "required": ["fileRef"]
}
```

**Output JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "properties": {
        "messageId": { "type": "string" },
        "status": { "type": "string", "enum": ["queued", "sent", "delivered"] },
        "sentAt": { "type": "string", "format": "date-time" }
      }
    },
    "error": { "type": "string" }
  }
}
```

**Reglas de Negocio (Zod):**
```typescript
const SendPdfWhatsappInput = z.object({
  fileRef: z.string().min(1),
  caption: z.string().max(200).optional(),
  fileName: z.string().max(100).optional(),
});

// Proceso:
// 1. Validar que fileRef es accesible
// 2. Obtener número de WhatsApp del cliente del contexto
// 3. Enviar via InfobipClient.sendDocument()
// 4. Registrar mensaje en AgentMessage
```

---

## Resumen de Políticas

### Tools que Requieren Confirmación

| Tool | Motivo |
|------|--------|
| `confirm_order` | Crea orden real, reserva stock |
| `modify_order_if_not_processed` | Modifica orden existente |
| `cancel_order_if_not_processed` | Cancela orden, libera stock |
| `apply_payment_to_balance` | Registra pago, modifica balance |
| `attach_receipt_to_order` | Asocia pago a orden |
| `quick_action_execute` | Según comando (descuentos >20%, cancelaciones) |

### Idempotency Keys por Categoría

| Categoría | Estrategia |
|-----------|------------|
| Creación de draft | `{sessionId}_{timestamp_minute}` |
| Items del carrito | `{sessionId}_{productId}_{variantId}_{quantity}_{timestamp_second}` |
| Confirmación de orden | `{sessionId}_{cartHash}_{timestamp_minute}` |
| Pagos | `{customerId}_{amount}_{reference}_{timestamp_minute}` |
| Quick Actions | `{sessionId}_{commandHash}_{timestamp_minute}` |

### Eventos Emitidos

| Evento | Tools que lo Emiten |
|--------|---------------------|
| `draft.created` | `create_order_draft` |
| `draft.item_added` | `add_item_to_draft` |
| `draft.item_updated` | `update_item_qty` |
| `draft.item_removed` | `remove_item`, `update_item_qty` |
| `draft.delivery_set` | `set_delivery_details` |
| `draft.confirmation_requested` | `request_confirmation` |
| `order.created` | `confirm_order` |
| `order.modified` | `modify_order_if_not_processed` |
| `order.cancelled` | `cancel_order_if_not_processed` |
| `stock.reserved` | `confirm_order` |
| `stock.released` | `cancel_order_if_not_processed` |
| `stock.adjusted` | `modify_order_if_not_processed` |
| `customer.created` | `get_or_create_customer_by_phone` |
| `customer.identity_updated` | `set_customer_identity` |
| `payment.received` | `apply_payment_to_balance`, `attach_receipt_to_order` |
| `payment_link.created` | `create_mercadopago_payment_link` |
| `debt.reduced` | `apply_payment_to_balance` |
| `reminder.scheduled` | `schedule_debt_reminder` |
| `receipt.ingested` | `ingest_receipt` |
| `receipt.parsed` | `parse_receipt_amount` |
| `receipt.attached` | `attach_receipt_to_order` |
| `session.handoff_requested` | `request_handoff` |
| `catalog.pdf_generated` | `generate_catalog_pdf` |
| `message.pdf_sent` | `send_pdf_whatsapp` |
| `quick_action.executed` | `quick_action_execute` |

---

*Documento generado: 2026-01-29*
*Versión: 1.0*
*Total de Tools: 31*
