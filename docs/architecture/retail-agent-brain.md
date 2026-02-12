# Retail Agent Brain - Arquitectura

## 1. Diagrama de Componentes

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                    ENTRADA                                           │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│    ┌──────────────┐     ┌──────────────┐     ┌──────────────┐                       │
│    │   Infobip    │     │   WhatsApp   │     │   Dashboard  │                       │
│    │   Webhook    │     │   Business   │     │  Quick Action│                       │
│    └──────┬───────┘     └──────────────┘     └──────┬───────┘                       │
│           │                                          │                               │
│           ▼                                          ▼                               │
│    ┌──────────────────────────────────────────────────────────────────┐             │
│    │                         API GATEWAY                               │             │
│    │                    (Fastify + Auth Plugin)                        │             │
│    └──────────────────────────────┬───────────────────────────────────┘             │
│                                   │                                                  │
└───────────────────────────────────┼──────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              CAPA DE DEDUPLICACIÓN                                   │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│    ┌──────────────────────────────────────────────────────────────────┐             │
│    │                      WEBHOOK INBOX (PostgreSQL)                   │             │
│    │  ┌─────────────────────────────────────────────────────────────┐ │             │
│    │  │ id | workspace_id | external_id | status | payload | ...    │ │             │
│    │  │ UNIQUE(workspace_id, external_id) ──► IDEMPOTENCIA          │ │             │
│    │  └─────────────────────────────────────────────────────────────┘ │             │
│    └──────────────────────────────┬───────────────────────────────────┘             │
│                                   │                                                  │
│                          status = 'pending'                                          │
│                                   │                                                  │
└───────────────────────────────────┼──────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                CAPA DE COLAS                                         │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│    ┌──────────────────────────────────────────────────────────────────┐             │
│    │                         REDIS + BullMQ                            │             │
│    │  ┌────────────────────┐    ┌────────────────────┐                │             │
│    │  │  AGENT_PROCESS     │    │   MESSAGE_SEND     │                │             │
│    │  │  (inbound queue)   │    │  (outbound queue)  │                │             │
│    │  │  - attempts: 3     │    │  - attempts: 5     │                │             │
│    │  │  - backoff: exp    │    │  - backoff: exp    │                │             │
│    │  │  - concurrency: 5  │    │  - priority queue  │                │             │
│    │  └─────────┬──────────┘    └─────────▲──────────┘                │             │
│    │            │                         │                            │             │
│    └────────────┼─────────────────────────┼────────────────────────────┘             │
│                 │                         │                                          │
└─────────────────┼─────────────────────────┼──────────────────────────────────────────┘
                  │                         │
                  ▼                         │
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              AGENT RUNTIME                                           │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│    ┌──────────────────────────────────────────────────────────────────┐             │
│    │                        AGENT WORKER                               │             │
│    │  ┌─────────────────────────────────────────────────────────────┐ │             │
│    │  │  1. Consume AGENT_PROCESS job                               │ │             │
│    │  │  2. Load/Create Session from Redis                          │ │             │
│    │  │  3. Initialize Retail Agent                                 │ │             │
│    │  │  4. Process Message                                         │ │             │
│    │  │  5. Enqueue Response to MESSAGE_SEND                        │ │             │
│    │  └─────────────────────────────────────────────────────────────┘ │             │
│    └──────────────────────────────┬───────────────────────────────────┘             │
│                                   │                                                  │
│                                   ▼                                                  │
│    ┌──────────────────────────────────────────────────────────────────┐             │
│    │                       RETAIL AGENT                                │             │
│    │  ┌───────────────┐  ┌───────────────┐  ┌───────────────────────┐ │             │
│    │  │ Memory        │  │ State         │  │ Conversation          │ │             │
│    │  │ Manager       │  │ Machine       │  │ Router                │ │             │
│    │  │ (Redis)       │  │ (FSM)         │  │ (Thread A/B)          │ │             │
│    │  └───────┬───────┘  └───────┬───────┘  └───────────┬───────────┘ │             │
│    │          │                  │                      │             │             │
│    │          ▼                  ▼                      ▼             │             │
│    │  ┌─────────────────────────────────────────────────────────────┐ │             │
│    │  │                    CLAUDE API (Anthropic)                   │ │             │
│    │  │   - System Prompt (comercio, reglas, herramientas)          │ │             │
│    │  │   - Conversation History (últimos 50 mensajes)              │ │             │
│    │  │   - Tool Definitions (JSON Schema)                          │ │             │
│    │  └───────────────────────────┬─────────────────────────────────┘ │             │
│    │                              │                                   │             │
│    └──────────────────────────────┼───────────────────────────────────┘             │
│                                   │                                                  │
│                            tool_use blocks                                           │
│                                   │                                                  │
│                                   ▼                                                  │
│    ┌──────────────────────────────────────────────────────────────────┐             │
│    │                       TOOL REGISTRY                               │             │
│    │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ │             │
│    │  │  CUSTOMER   │ │  PRODUCT    │ │    CART     │ │   ORDER     │ │             │
│    │  │  - getInfo  │ │  - search   │ │  - add      │ │  - confirm  │ │             │
│    │  │  - update   │ │  - details  │ │  - update   │ │  - cancel   │ │             │
│    │  │  - getDebt  │ │  - categs   │ │  - remove   │ │  - modify   │ │             │
│    │  │  - history  │ │             │ │  - clear    │ │  - details  │ │             │
│    │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘ │             │
│    │  ┌─────────────┐ ┌─────────────┐                                 │             │
│    │  │  COMMERCE   │ │   SYSTEM    │                                 │             │
│    │  │  - profile  │ │  - handoff  │                                 │             │
│    │  │  - payment  │ │  - repeat   │                                 │             │
│    │  │  - catalog  │ │             │                                 │             │
│    │  └─────────────┘ └─────────────┘                                 │             │
│    └──────────────────────────────┬───────────────────────────────────┘             │
│                                   │                                                  │
└───────────────────────────────────┼──────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              CAPA DE DATOS                                           │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│    ┌────────────────────────────┐    ┌────────────────────────────────┐             │
│    │      PostgreSQL (Prisma)   │    │           Redis                 │             │
│    │  ┌──────────────────────┐  │    │  ┌──────────────────────────┐  │             │
│    │  │ Customer             │  │    │  │ Session Memory           │  │             │
│    │  │ Product / Variant    │  │    │  │ - state                  │  │             │
│    │  │ StockItem            │  │    │  │ - cart (items, totals)   │  │             │
│    │  │ Order / OrderItem    │  │    │  │ - context                │  │             │
│    │  │ Payment              │  │    │  │ - pendingConfirmation    │  │             │
│    │  │ AgentSession         │  │    │  │ TTL: 24 horas            │  │             │
│    │  │ AgentMessage         │  │    │  └──────────────────────────┘  │             │
│    │  │ AgentToolExecution   │  │    │  ┌──────────────────────────┐  │             │
│    │  │ AuditLog             │  │    │  │ Idempotency Keys         │  │             │
│    │  │ WebhookInbox         │  │    │  │ TTL: 1 hora              │  │             │
│    │  └──────────────────────┘  │    │  └──────────────────────────┘  │             │
│    └────────────────────────────┘    └────────────────────────────────┘             │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                  SALIDA                                              │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│    ┌──────────────────────────────────────────────────────────────────┐             │
│    │                      MESSAGE SEND WORKER                          │             │
│    │  1. Consume MESSAGE_SEND job                                      │             │
│    │  2. Load WhatsApp credentials for workspace                       │             │
│    │  3. Send via InfobipClient.sendText()                             │             │
│    │  4. Update AgentMessage with delivery status                      │             │
│    └──────────────────────────────┬───────────────────────────────────┘             │
│                                   │                                                  │
│                                   ▼                                                  │
│    ┌──────────────────────────────────────────────────────────────────┐             │
│    │                       INFOBIP API                                 │             │
│    │                  POST /whatsapp/1/message/text                    │             │
│    └──────────────────────────────────────────────────────────────────┘             │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Flujo End-to-End

### 2.1 Inbound Flow (Mensaje Entrante)

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           FLUJO: MENSAJE ENTRANTE                                    │
└─────────────────────────────────────────────────────────────────────────────────────┘

   CLIENTE                 INFOBIP              API                WORKER              CLAUDE
      │                       │                   │                   │                   │
      │   "Hola, quiero      │                   │                   │                   │
      │    2 cocas"          │                   │                   │                   │
      │──────────────────────▶                   │                   │                   │
      │                       │                   │                   │                   │
      │                       │  POST /webhooks   │                   │                   │
      │                       │  /infobip/:id     │                   │                   │
      │                       │──────────────────▶│                   │                   │
      │                       │                   │                   │                   │
      │                       │                   │ ┌───────────────┐ │                   │
      │                       │                   │ │ 1. DEDUPE     │ │                   │
      │                       │                   │ │ - Check       │ │                   │
      │                       │                   │ │   external_id │ │                   │
      │                       │                   │ │ - If exists,  │ │                   │
      │                       │                   │ │   return 200  │ │                   │
      │                       │                   │ │ - Else, insert│ │                   │
      │                       │                   │ │   WebhookInbox│ │                   │
      │                       │                   │ └───────────────┘ │                   │
      │                       │                   │                   │                   │
      │                       │                   │ ┌───────────────┐ │                   │
      │                       │                   │ │ 2. QUEUE      │ │                   │
      │                       │                   │ │ - Add job to  │ │                   │
      │                       │                   │ │   AGENT_PROCESS│                   │
      │                       │                   │ │ - Return 200  │ │                   │
      │                       │                   │ └───────────────┘ │                   │
      │                       │                   │                   │                   │
      │                       │   200 OK          │                   │                   │
      │                       │◀──────────────────│                   │                   │
      │                       │                   │                   │                   │
      │                       │                   │    BullMQ Job     │                   │
      │                       │                   │──────────────────▶│                   │
      │                       │                   │                   │                   │
      │                       │                   │                   │ ┌───────────────┐ │
      │                       │                   │                   │ │ 3. PROCESS    │ │
      │                       │                   │                   │ │ - Load session│ │
      │                       │                   │                   │ │ - Get history │ │
      │                       │                   │                   │ │ - Build ctx   │ │
      │                       │                   │                   │ └───────────────┘ │
      │                       │                   │                   │                   │
      │                       │                   │                   │  messages.create  │
      │                       │                   │                   │──────────────────▶│
      │                       │                   │                   │                   │
      │                       │                   │                   │                   │ ┌─────────────┐
      │                       │                   │                   │                   │ │ 4. REASON   │
      │                       │                   │                   │                   │ │ - Parse     │
      │                       │                   │                   │                   │ │   intent    │
      │                       │                   │                   │                   │ │ - Choose    │
      │                       │                   │                   │                   │ │   tools     │
      │                       │                   │                   │                   │ └─────────────┘
      │                       │                   │                   │                   │
      │                       │                   │                   │   tool_use:       │
      │                       │                   │                   │   search_products │
      │                       │                   │                   │◀──────────────────│
      │                       │                   │                   │                   │
      │                       │                   │                   │ ┌───────────────┐ │
      │                       │                   │                   │ │ 5. TOOL EXEC  │ │
      │                       │                   │                   │ │ - Validate    │ │
      │                       │                   │                   │ │   input (Zod) │ │
      │                       │                   │                   │ │ - Check       │ │
      │                       │                   │                   │ │   idempotency │ │
      │                       │                   │                   │ │ - Execute     │ │
      │                       │                   │                   │ │ - Audit log   │ │
      │                       │                   │                   │ └───────────────┘ │
      │                       │                   │                   │                   │
      │                       │                   │                   │   tool_result     │
      │                       │                   │                   │──────────────────▶│
      │                       │                   │                   │                   │
      │                       │                   │                   │   ... (loop)      │
      │                       │                   │                   │   tool_use:       │
      │                       │                   │                   │   add_to_cart     │
      │                       │                   │                   │◀──────────────────│
      │                       │                   │                   │   (execute)       │
      │                       │                   │                   │──────────────────▶│
      │                       │                   │                   │                   │
      │                       │                   │                   │   end_turn +      │
      │                       │                   │                   │   text response   │
      │                       │                   │                   │◀──────────────────│
      │                       │                   │                   │                   │
      │                       │                   │                   │ ┌───────────────┐ │
      │                       │                   │                   │ │ 6. FINALIZE   │ │
      │                       │                   │                   │ │ - Save session│ │
      │                       │                   │                   │ │ - Update FSM  │ │
      │                       │                   │                   │ │ - Store msg   │ │
      │                       │                   │                   │ │ - Queue reply │ │
      │                       │                   │                   │ └───────────────┘ │
      │                       │                   │                   │                   │
```

### 2.2 Outbound Flow (Respuesta)

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           FLUJO: RESPUESTA SALIENTE                                  │
└─────────────────────────────────────────────────────────────────────────────────────┘

   WORKER                MESSAGE_SEND            SEND WORKER           INFOBIP          CLIENTE
      │                   QUEUE                      │                   │                   │
      │                      │                       │                   │                   │
      │  enqueue response    │                       │                   │                   │
      │─────────────────────▶│                       │                   │                   │
      │                      │                       │                   │                   │
      │                      │     consume job       │                   │                   │
      │                      │──────────────────────▶│                   │                   │
      │                      │                       │                   │                   │
      │                      │                       │ ┌───────────────┐ │                   │
      │                      │                       │ │ 1. LOAD CREDS │ │                   │
      │                      │                       │ │ - Get WA      │ │                   │
      │                      │                       │ │   number from │ │                   │
      │                      │                       │ │   workspace   │ │                   │
      │                      │                       │ └───────────────┘ │                   │
      │                      │                       │                   │                   │
      │                      │                       │  POST /message    │                   │
      │                      │                       │──────────────────▶│                   │
      │                      │                       │                   │                   │
      │                      │                       │   200 OK          │                   │
      │                      │                       │◀──────────────────│                   │
      │                      │                       │                   │                   │
      │                      │                       │                   │  WhatsApp msg     │
      │                      │                       │                   │──────────────────▶│
      │                      │                       │                   │                   │
      │                      │                       │                   │   "Perfecto!      │
      │                      │                       │                   │    Agregué 2      │
      │                      │                       │                   │    Coca-Cola al   │
      │                      │                       │                   │    carrito..."    │
      │                      │                       │                   │                   │
```

---

## 3. FSM Detallada (Finite State Machine)

### 3.1 Diagrama de Estados

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              MÁQUINA DE ESTADOS                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘

                                    ┌──────────────┐
                                    │              │
                             ┌──────│     IDLE     │◀──────┐
                             │      │              │       │
                             │      └──────┬───────┘       │
                             │             │               │
                             │    add_to_cart /            │  clear_cart /
                             │    search_products          │  order_completed
                             │             │               │
                             │             ▼               │
                             │      ┌──────────────┐       │
                             │      │  COLLECTING  │       │
                             │      │    ORDER     │◀──┐   │
                             │      └──────┬───────┘   │   │
                             │             │           │   │
                             │    customer needs       │   │
                             │    DNI/name/address     │   │
                             │             │           │   │
                             │             ▼           │   │
                             │      ┌──────────────┐   │   │
                             │      │    NEEDS     │   │   │
                             │      │   DETAILS    │───┘   │
                             │      └──────┬───────┘       │
                             │             │  details      │
                             │             │  provided     │
                             │             ▼               │
                             │      ┌──────────────┐       │
                             │      │   AWAITING   │       │
                             │      │ CONFIRMATION │       │
                             │      └──────┬───────┘       │
                             │             │               │
                             │     ┌───────┴───────┐       │
                             │     │               │       │
                             │  confirm         cancel     │
                             │     │               │       │
                             │     ▼               │       │
                             │ ┌──────────┐        │       │
                             │ │EXECUTING │        │       │
                             │ └────┬─────┘        │       │
                             │      │              │       │
                             │   success           │       │
                             │      │              │       │
                             │      ▼              │       │
                             │ ┌──────────┐        │       │
                             │ │   DONE   │────────┴───────┘
                             │ └──────────┘
                             │
                             │
         ┌───────────────────┴───────────────────┐
         │        HANDOFF (desde cualquier       │
         │              estado)                  │
         │                                       │
         │   Triggers:                           │
         │   - 2 errores consecutivos            │
         │   - Sentimiento muy negativo          │
         │   - Pedido ya procesado               │
         │   - request_handoff explícito         │
         └───────────────────────────────────────┘
                             │
                             ▼
                      ┌──────────────┐
                      │   HANDOFF    │
                      │  (terminal)  │
                      └──────────────┘
```

### 3.2 Tabla de Estados, Transiciones y Tools Permitidas

| Estado | Descripción | Transiciones Válidas | Tools Permitidas | Transiciones Automáticas |
|--------|-------------|---------------------|------------------|-------------------------|
| **IDLE** | Sin actividad de pedido | → COLLECTING_ORDER | `get_customer_info`, `search_products`, `get_categories`, `get_commerce_profile`, `get_customer_debt`, `get_order_history`, `repeat_last_order` | Si se usa `add_to_cart` → COLLECTING_ORDER |
| **COLLECTING_ORDER** | Armando carrito | → NEEDS_DETAILS, → AWAITING_CONFIRMATION, → IDLE, → HANDOFF | Todas las tools de IDLE + `add_to_cart`, `update_cart_item`, `remove_from_cart`, `clear_cart`, `get_cart`, `set_cart_notes` | Si cliente dice "confirmar" y faltan datos → NEEDS_DETAILS |
| **NEEDS_DETAILS** | Esperando DNI/nombre/dirección | → COLLECTING_ORDER, → AWAITING_CONFIRMATION, → HANDOFF | `update_customer_info`, `get_customer_info`, `get_cart` | Si se completan datos requeridos → AWAITING_CONFIRMATION |
| **AWAITING_CONFIRMATION** | Mostrando resumen, esperando "sí" | → EXECUTING, → COLLECTING_ORDER, → IDLE, → HANDOFF | `get_cart`, `confirm_order` (requiere confirmación explícita) | Si cliente dice "no" o modifica → COLLECTING_ORDER |
| **EXECUTING** | Procesando confirmación | → DONE, → HANDOFF | `confirm_order` (interno) | Automático tras éxito/fallo |
| **DONE** | Pedido completado | → IDLE, → COLLECTING_ORDER | Todas las tools de IDLE | Reset a IDLE tras inactividad o nuevo pedido |
| **HANDOFF** | Control pasado a humano | (terminal - requiere intervención manual) | `get_cart`, `get_order_details`, `get_customer_info` (solo lectura) | Ninguna - requiere que humano reactive |

### 3.3 Reglas de Transición

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           REGLAS DE TRANSICIÓN                                       │
└─────────────────────────────────────────────────────────────────────────────────────┘

IDLE → COLLECTING_ORDER
  Trigger: add_to_cart usado con éxito
  Acción: Inicializar carrito si no existe

COLLECTING_ORDER → NEEDS_DETAILS
  Trigger: Cliente quiere confirmar PERO falta:
    - DNI (customer.dni == null)
    - Nombre (customer.firstName == null)
    - Dirección de envío (cart.shippingAddress == null) [si aplica delivery]
  Acción: Guardar contexto, preguntar dato faltante

NEEDS_DETAILS → COLLECTING_ORDER
  Trigger: Cliente proporciona dato pero aún faltan otros O quiere modificar carrito
  Acción: Actualizar customer/cart

NEEDS_DETAILS → AWAITING_CONFIRMATION
  Trigger: Todos los datos requeridos completos
  Acción: Mostrar resumen del pedido

COLLECTING_ORDER → AWAITING_CONFIRMATION
  Trigger: Cliente dice "confirmar" Y todos los datos están completos
  Acción: Mostrar resumen completo

AWAITING_CONFIRMATION → EXECUTING
  Trigger: Cliente confirma explícitamente ("sí", "dale", "confirmo")
  Acción: Ejecutar confirm_order tool

AWAITING_CONFIRMATION → COLLECTING_ORDER
  Trigger: Cliente modifica pedido o dice "no"
  Acción: Volver a editar carrito

EXECUTING → DONE
  Trigger: confirm_order exitoso
  Acción:
    - Crear Order en DB
    - Reservar stock
    - Limpiar carrito de Redis
    - Notificar al cliente

EXECUTING → HANDOFF
  Trigger: Error en confirm_order
  Acción: Notificar que hay un problema, pasar a humano

DONE → IDLE
  Trigger:
    - Inactividad > 30 min
    - Cliente inicia nueva conversación
  Acción: Reset de contexto de pedido (mantener historial)

* → HANDOFF (desde cualquier estado)
  Triggers:
    - request_handoff tool explícito
    - 2 errores de herramienta consecutivos
    - Análisis de sentimiento muy negativo
    - Pedido ya procesado (status = PROCESSED)
  Acción:
    - Notificar al cliente
    - Marcar sesión como handoff
    - Notificar al dashboard (WebSocket)
```

---

## 4. Conversation Router (Thread A/B)

### 4.1 Concepto de Hilos

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           CONVERSATION ROUTER                                        │
└─────────────────────────────────────────────────────────────────────────────────────┘

El agente mantiene DOS hilos conceptuales en memoria:

┌────────────────────────────────────┐    ┌────────────────────────────────────┐
│         THREAD A: ORDER            │    │         THREAD B: INFO             │
│                                    │    │                                    │
│  Contexto persistente:             │    │  Contexto efímero:                 │
│  - Estado FSM actual               │    │  - Pregunta actual                 │
│  - Carrito completo                │    │  - Respuesta dada                  │
│  - Datos del cliente               │    │                                    │
│  - Último producto consultado      │    │  Temas:                            │
│                                    │    │  - Horarios                        │
│  Prioridad: ALTA                   │    │  - Ubicación                       │
│  Persiste: Toda la sesión          │    │  - Políticas                       │
│                                    │    │  - Métodos de pago                 │
│                                    │    │  - Delivery                        │
│                                    │    │                                    │
│                                    │    │  Prioridad: BAJA                   │
│                                    │    │  Persiste: Solo respuesta actual   │
└────────────────────────────────────┘    └────────────────────────────────────┘
```

### 4.2 Flujo de Router

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         FLUJO DEL CONVERSATION ROUTER                                │
└─────────────────────────────────────────────────────────────────────────────────────┘

                    Mensaje Entrante
                           │
                           ▼
                  ┌────────────────┐
                  │   CLASIFICAR   │
                  │    INTENCIÓN   │
                  └────────┬───────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
           ▼               ▼               ▼
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │   ORDER     │ │    INFO     │ │   MIXTO     │
    │  RELATED    │ │  RELATED    │ │  (ambos)    │
    └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
           │               │               │
           │               │               │
           ▼               ▼               ▼
    ┌─────────────────────────────────────────────┐
    │              PROCESS MESSAGE                 │
    └─────────────────────────────────────────────┘
           │
           │
           ▼
    ┌─────────────────────────────────────────────┐
    │        ¿Es INFO interrumpiendo ORDER?        │
    │                                              │
    │   Ejemplo: Cliente armando carrito y        │
    │   pregunta "¿A qué hora cierran?"           │
    └──────────────────┬──────────────────────────┘
                       │
           ┌───────────┴───────────┐
           │ SÍ                    │ NO
           ▼                       ▼
    ┌─────────────────┐    ┌─────────────────┐
    │  1. Guardar     │    │  Procesar       │
    │     contexto    │    │  normalmente    │
    │     ORDER en    │    │                 │
    │     interruptedTopic │                 │
    │                 │    │                 │
    │  2. Responder   │    │                 │
    │     INFO        │    │                 │
    │                 │    │                 │
    │  3. Incluir     │    │                 │
    │     "bridge"    │    │                 │
    │     al ORDER    │    │                 │
    └─────────────────┘    └─────────────────┘
```

### 4.3 Ejemplo Práctico: INFO Interrumpe ORDER

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                    EJEMPLO: INTERRUPCIÓN INFO → ORDER                                │
└─────────────────────────────────────────────────────────────────────────────────────┘

CONTEXTO INICIAL:
- Estado: COLLECTING_ORDER
- Carrito: [2x Coca-Cola, 1x Fanta]
- interruptedTopic: null

─────────────────────────────────────────────────────────────────────────────────────

CLIENTE: "Che, ¿hasta qué hora están abiertos?"

CLASIFICACIÓN: INFO (pregunta sobre horarios)

ACCIÓN DEL ROUTER:
1. Detectar que hay ORDER activo (estado != IDLE && carrito no vacío)
2. Guardar en memoria:
   ```
   interruptedTopic: {
     type: 'order',
     state: 'COLLECTING_ORDER',
     lastProduct: 'Coca-Cola',
     cartSummary: '2x Coca-Cola, 1x Fanta'
   }
   ```
3. Procesar pregunta INFO

TOOL USADO: get_commerce_profile

RESPUESTA DEL AGENTE:
"Estamos abiertos de lunes a viernes de 9 a 20hs y sábados de 10 a 14hs.

Por cierto, tenés 2 Coca-Cola y 1 Fanta en el carrito. ¿Querés agregar algo más o confirmamos?"
                     ▲
                     │
            "Bridge" de regreso al ORDER

ESTADO POST-RESPUESTA:
- Estado: COLLECTING_ORDER (sin cambios)
- Carrito: [2x Coca-Cola, 1x Fanta] (sin cambios)
- interruptedTopic: null (limpiado)

─────────────────────────────────────────────────────────────────────────────────────

CLIENTE: "Sí, agregá 2 pepsi"

CLASIFICACIÓN: ORDER (agregar producto)

TOOL USADO: add_to_cart

RESPUESTA: "Perfecto, agregué 2 Pepsi. Tu carrito ahora tiene..."
```

### 4.4 Matriz de Decisión del Router

| Estado Actual | Tipo de Mensaje | Acción | Bridge al Volver |
|--------------|-----------------|--------|------------------|
| IDLE | ORDER | Procesar, transicionar a COLLECTING | No aplica |
| IDLE | INFO | Responder directamente | No aplica |
| COLLECTING_ORDER | ORDER | Procesar normalmente | No aplica |
| COLLECTING_ORDER | INFO | Guardar contexto, responder, bridge | "Tu carrito tiene X. ¿Seguimos?" |
| NEEDS_DETAILS | ORDER | Recordar qué dato falta | No aplica |
| NEEDS_DETAILS | INFO | Responder, recordar dato faltante | "Por cierto, necesito tu [dato]" |
| AWAITING_CONFIRMATION | ORDER | Interpretar como modificación | No aplica |
| AWAITING_CONFIRMATION | INFO | Responder, mostrar resumen de nuevo | "El total sigue siendo $X. ¿Confirmamos?" |
| DONE | ORDER | Iniciar nuevo pedido | No aplica |
| DONE | INFO | Responder normalmente | No aplica |
| HANDOFF | * | Informar que hay un humano atendiendo | No aplica |

### 4.5 Implementación en el System Prompt

```
## REGLAS DE CONVERSACIÓN

### Manejo de Hilos (Thread A: ORDER / Thread B: INFO)

1. **Thread A (ORDER)** tiene prioridad. Si el cliente está armando un pedido:
   - NUNCA pierdas el contexto del carrito
   - SIEMPRE incluye un "bridge" al responder preguntas INFO

2. **Thread B (INFO)** es efímero:
   - Responde la pregunta directamente
   - NO cambies el estado del pedido
   - Usa get_commerce_profile para info del negocio

3. **Bridge de regreso**:
   Si respondes una pregunta INFO mientras hay un pedido activo, SIEMPRE termina con:
   - Recordatorio del carrito actual
   - Pregunta para continuar ("¿Seguimos con el pedido?")

### Ejemplo de Bridge:

MALO:
Usuario: "¿Hacen delivery?"
Asistente: "Sí, hacemos delivery en toda la zona."

BUENO:
Usuario: "¿Hacen delivery?"
Asistente: "Sí, hacemos delivery en toda la zona. El costo es $500 para pedidos menores a $5000.

Por cierto, tu carrito tiene 2 Coca-Cola y 1 Fanta por $2.500. ¿Querés agregar algo más o confirmamos?"
```

---

## 5. Estrategia HANDOFF

### 5.1 Triggers de Handoff

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           TRIGGERS DE HANDOFF                                        │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────┐
│  TRIGGER 1: 2 ERRORES CONSECUTIVOS                                                   │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Contador en SessionMemory:                                                          │
│  ```                                                                                 │
│  {                                                                                   │
│    consecutiveErrors: 0,  // Reset a 0 tras tool exitoso                            │
│    lastError: null                                                                   │
│  }                                                                                   │
│  ```                                                                                 │
│                                                                                      │
│  Flujo:                                                                              │
│  1. Tool falla → consecutiveErrors++                                                │
│  2. consecutiveErrors >= 2 → HANDOFF                                                │
│  3. Tool exitoso → consecutiveErrors = 0                                            │
│                                                                                      │
│  Ejemplos de errores que cuentan:                                                    │
│  - Producto no encontrado (tras búsqueda real)                                      │
│  - Stock insuficiente (no puede satisfacer)                                         │
│  - Error de validación de datos                                                     │
│  - Timeout de DB/Redis                                                              │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────┐
│  TRIGGER 2: SENTIMIENTO MUY NEGATIVO                                                 │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Análisis en el System Prompt:                                                       │
│  ```                                                                                 │
│  Si el cliente expresa:                                                              │
│  - Frustración repetida ("no entendés", "ya te dije")                               │
│  - Enojo explícito ("esto es una porquería", insultos)                              │
│  - Pedido de hablar con humano ("quiero hablar con alguien real")                   │
│  - Amenaza ("voy a reclamar", "los voy a denunciar")                                │
│                                                                                      │
│  → Usar request_handoff con triggerType: 'negative_sentiment'                       │
│  ```                                                                                 │
│                                                                                      │
│  Keywords/Patterns a detectar:                                                       │
│  - "no me entendés"                                                                 │
│  - "hablar con una persona"                                                         │
│  - "esto no sirve"                                                                  │
│  - "quiero quejarme"                                                                │
│  - Insultos o lenguaje agresivo                                                     │
│  - 3+ mensajes sin resolución                                                        │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────┐
│  TRIGGER 3: PEDIDO YA PROCESADO                                                      │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Estados de Order que bloquean modificación:                                         │
│  ```typescript                                                                       │
│  const PROCESSED_STATUSES = [                                                        │
│    'processing',    // En preparación                                               │
│    'shipped',       // En camino                                                    │
│    'delivered',     // Entregado                                                    │
│    'completed'      // Finalizado                                                   │
│  ];                                                                                  │
│  ```                                                                                 │
│                                                                                      │
│  Flujo:                                                                              │
│  1. Cliente pide modificar/cancelar orden                                           │
│  2. get_order_details retorna status en PROCESSED_STATUSES                          │
│  3. Agent detecta que no puede modificar                                            │
│  4. → HANDOFF con triggerType: 'order_already_processed'                            │
│                                                                                      │
│  Mensaje al cliente:                                                                 │
│  "Tu pedido #ORD-00042 ya está en preparación y no puedo modificarlo desde          │
│  acá. Te paso con alguien del equipo que te va a ayudar."                           │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────┐
│  TRIGGER 4: REQUEST EXPLÍCITO                                                        │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  El cliente pide hablar con humano:                                                 │
│  - "Quiero hablar con alguien"                                                      │
│  - "Pasame con una persona"                                                         │
│  - "Esto es un bot?"                                                                │
│  - "Necesito ayuda de verdad"                                                       │
│                                                                                      │
│  → Usar request_handoff con triggerType: 'customer_request'                         │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Flujo de Handoff

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              FLUJO DE HANDOFF                                        │
└─────────────────────────────────────────────────────────────────────────────────────┘

         AGENT                    SYSTEM                  DASHBOARD              HUMANO
            │                        │                        │                     │
            │  request_handoff       │                        │                     │
            │───────────────────────▶│                        │                     │
            │                        │                        │                     │
            │                        │ ┌────────────────────┐ │                     │
            │                        │ │ 1. Update Session  │ │                     │
            │                        │ │    agentActive=false│                     │
            │                        │ │    currentState=    │ │                     │
            │                        │ │    'HANDOFF'        │ │                     │
            │                        │ └────────────────────┘ │                     │
            │                        │                        │                     │
            │                        │ ┌────────────────────┐ │                     │
            │                        │ │ 2. Create          │ │                     │
            │                        │ │    HandoffRequest  │ │                     │
            │                        │ │    record in DB    │ │                     │
            │                        │ └────────────────────┘ │                     │
            │                        │                        │                     │
            │                        │   WebSocket: new_handoff                     │
            │                        │───────────────────────▶│                     │
            │                        │                        │                     │
            │                        │                        │ ┌─────────────────┐ │
            │                        │                        │ │ 3. Show         │ │
            │                        │                        │ │    notification │ │
            │                        │                        │ │    + session    │ │
            │                        │                        │ │    in Inbox     │ │
            │                        │                        │ └─────────────────┘ │
            │                        │                        │                     │
            │                        │                        │  Operador ve        │
            │                        │                        │──────────────────▶│
            │                        │                        │                     │
            │  ToolResult:           │                        │                     │
            │  {success, message}    │                        │                     │
            │◀───────────────────────│                        │                     │
            │                        │                        │                     │
            │  Enviar mensaje        │                        │                     │
            │  al cliente            │                        │                     │
            │─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─▶                        │                     │
            │                        │                        │                     │
    "Te paso con alguien del equipo                          │                     │
     que te va a ayudar. Ya están                            │                     │
     al tanto de tu pedido."                                 │                     │
            │                        │                        │                     │
            │                        │                        │                     │
            │  [AGENT DESACTIVADO]   │                        │     Responde       │
            │                        │                        │◀────────────────────│
            │                        │                        │                     │
            │                        │  Mensaje del humano    │                     │
            │                        │  va directo a Infobip  │                     │
            │                        │  sin pasar por agent   │                     │
            │                        │                        │                     │
```

### 5.3 Datos del Handoff

```typescript
interface HandoffRequest {
  id: string;
  sessionId: string;
  workspaceId: string;
  customerId: string;

  // Trigger info
  triggerType: 'consecutive_errors' | 'negative_sentiment' | 'order_already_processed' | 'customer_request';
  triggerReason: string;  // Descripción legible

  // Contexto para el humano
  context: {
    currentState: AgentStateType;
    cartSummary: string | null;      // "2x Coca-Cola, 1x Fanta - $2.500"
    lastMessages: string[];          // Últimos 5 mensajes
    customerInfo: {
      name: string | null;
      phone: string;
      totalOrders: number;
      totalSpent: number;
    };
    pendingIssue: string;            // "Cliente quiere cancelar pedido #ORD-00042"
  };

  // Status
  status: 'pending' | 'assigned' | 'resolved';
  assignedTo: string | null;         // userId del operador
  assignedAt: Date | null;
  resolvedAt: Date | null;
  resolution: string | null;         // Cómo se resolvió

  createdAt: Date;
}
```

### 5.4 Reactivación del Agente Post-Handoff

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         REACTIVACIÓN POST-HANDOFF                                    │
└─────────────────────────────────────────────────────────────────────────────────────┘

El agente SOLO se reactiva manualmente desde el Dashboard:

1. Operador resuelve el problema
2. Click en "Reactivar IA" en la sesión
3. Sistema:
   - agentActive = true
   - currentState = 'IDLE' (o estado apropiado)
   - Limpia carrito si estaba corrupto
   - Opcionalmente: envía mensaje automático

Mensaje opcional de reactivación:
"¡Listo! El equipo resolvió tu consulta. Soy [NombreBot] y puedo
seguir ayudándote con tus pedidos. ¿Necesitás algo más?"
```

---

## Checklist de Completitud

| # | Entregable | Estado |
|---|------------|--------|
| 1 | Diagrama textual de componentes | ✅ Sección 1 |
| 2 | Flujo end-to-end: inbound -> agent -> tools -> reply | ✅ Sección 2 |
| 3 | FSM detallada (estados, transiciones, triggers, tools por estado) | ✅ Sección 3 |
| 4 | Conversation Router con Thread A (ORDER) y Thread B (INFO) | ✅ Sección 4 |
| 5 | Estrategia HANDOFF (2 fallas, sentimiento negativo, pedido procesado) | ✅ Sección 5 |

---

*Documento generado: 2026-01-29*
*Versión: 1.0*
