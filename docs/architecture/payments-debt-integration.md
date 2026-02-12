# ENTREGABLE 6: Integración de Pagos, Comprobantes y Deuda

## Índice
1. [Resumen Ejecutivo](#resumen-ejecutivo)
2. [Arquitectura de Pagos](#arquitectura-de-pagos)
3. [Integración Mercado Pago](#integración-mercado-pago)
4. [Flujo de Comprobantes (Receipts)](#flujo-de-comprobantes)
5. [Modelo de Deuda](#modelo-de-deuda)
6. [Jobs y Recordatorios](#jobs-y-recordatorios)
7. [Tools del Agente](#tools-del-agente)
8. [UI de Configuración](#ui-de-configuración)
9. [Schemas y Contratos](#schemas-y-contratos)

---

## 1. Resumen Ejecutivo

### Objetivos
- Integrar Mercado Pago como procesador de pagos principal
- Permitir ingesta de comprobantes (transferencias bancarias, efectivo)
- Mantener un ledger de deudas por cliente
- Automatizar recordatorios de deuda
- Proveer tools al agente para gestionar pagos

### Principios de Diseño
- **Idempotencia**: Cada operación de pago tiene un ID único
- **Audit Trail**: Todo movimiento queda registrado
- **Confirmaciones**: Pagos requieren confirmación explícita
- **Multi-tenant**: Cada workspace tiene su propia configuración de MP

---

## 2. Arquitectura de Pagos

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PAYMENT ARCHITECTURE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                   │
│  │   WhatsApp   │    │   Dashboard  │    │   Webhook    │                   │
│  │   (Cliente)  │    │   (Dueño)    │    │   (MP/Bank)  │                   │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘                   │
│         │                   │                   │                            │
│         ▼                   ▼                   ▼                            │
│  ┌─────────────────────────────────────────────────────────────┐            │
│  │                      API GATEWAY                             │            │
│  │   POST /payments/create-link                                 │            │
│  │   POST /payments/webhook/mercadopago                         │            │
│  │   POST /payments/receipts/upload                             │            │
│  │   POST /payments/apply                                       │            │
│  └─────────────────────────────────────────────────────────────┘            │
│                              │                                               │
│                              ▼                                               │
│  ┌─────────────────────────────────────────────────────────────┐            │
│  │                    PAYMENT SERVICE                           │            │
│  │                                                              │            │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐             │            │
│  │  │ LinkGen    │  │ Webhook    │  │ Receipt    │             │            │
│  │  │ Service    │  │ Processor  │  │ Processor  │             │            │
│  │  └────────────┘  └────────────┘  └────────────┘             │            │
│  │         │              │               │                     │            │
│  │         └──────────────┼───────────────┘                     │            │
│  │                        ▼                                     │            │
│  │              ┌─────────────────┐                             │            │
│  │              │  Ledger Engine  │                             │            │
│  │              │  (Debt/Credit)  │                             │            │
│  │              └─────────────────┘                             │            │
│  └─────────────────────────────────────────────────────────────┘            │
│                              │                                               │
│         ┌────────────────────┼────────────────────┐                         │
│         ▼                    ▼                    ▼                          │
│  ┌────────────┐      ┌────────────┐      ┌────────────┐                     │
│  │  Payment   │      │  Ledger    │      │  Receipt   │                     │
│  │  (Prisma)  │      │  Entry     │      │  (File)    │                     │
│  └────────────┘      └────────────┘      └────────────┘                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Componentes Principales

| Componente | Responsabilidad |
|------------|-----------------|
| **LinkGen Service** | Genera links de pago MP con preferencias |
| **Webhook Processor** | Procesa notificaciones IPN de MP |
| **Receipt Processor** | Valida y registra comprobantes manuales |
| **Ledger Engine** | Gestiona balance de deuda por cliente |

---

## 3. Integración Mercado Pago

### 3.1 OAuth Flow (Conexión desde Dashboard)

```
┌─────────┐     ┌─────────┐     ┌─────────────┐     ┌──────────┐
│ Dashboard│     │   API   │     │ MercadoPago │     │ Database │
└────┬────┘     └────┬────┘     └──────┬──────┘     └────┬─────┘
     │               │                 │                  │
     │ Click "Conectar MP"            │                  │
     │──────────────>│                 │                  │
     │               │                 │                  │
     │               │ Generate OAuth URL                 │
     │               │ (client_id, redirect_uri, state)   │
     │               │────────────────>│                  │
     │               │                 │                  │
     │<──────────────│ Redirect to MP  │                  │
     │               │                 │                  │
     │ User authorizes in MP          │                  │
     │─────────────────────────────────>│                  │
     │               │                 │                  │
     │               │<────────────────│                  │
     │               │ Callback with code                 │
     │               │                 │                  │
     │               │ Exchange code for tokens           │
     │               │────────────────>│                  │
     │               │                 │                  │
     │               │<────────────────│                  │
     │               │ access_token, refresh_token        │
     │               │                 │                  │
     │               │ Store encrypted tokens             │
     │               │─────────────────────────────────────>│
     │               │                 │                  │
     │<──────────────│ Success         │                  │
     │               │                 │                  │
```

### 3.2 Crear Link de Pago

```typescript
// POST /api/v1/payments/create-link
interface CreatePaymentLinkRequest {
  workspaceId: string;
  orderId?: string;           // Opcional: vincular a orden
  customerId: string;
  amount: number;             // En centavos (ARS)
  description: string;
  externalReference: string;  // Idempotency key
  expirationMinutes?: number; // Default: 60
  metadata?: Record<string, unknown>;
}

interface CreatePaymentLinkResponse {
  success: boolean;
  data: {
    paymentId: string;        // ID interno
    preferenceId: string;     // MP preference ID
    initPoint: string;        // URL de pago (checkout)
    sandboxInitPoint?: string;
    expiresAt: string;
  };
}
```

### 3.3 Webhook de Confirmación

```typescript
// POST /api/v1/webhooks/mercadopago
// Headers: x-signature (HMAC verification)

interface MPWebhookPayload {
  action: 'payment.created' | 'payment.updated';
  api_version: string;
  data: {
    id: string;  // Payment ID
  };
  date_created: string;
  id: number;
  live_mode: boolean;
  type: 'payment';
  user_id: string;
}

// Procesamiento:
// 1. Verificar firma HMAC
// 2. Obtener detalles del pago via API MP
// 3. Buscar Payment por external_reference
// 4. Actualizar estado: pending -> completed/failed
// 5. Si completed: actualizar Order.paidAt y Ledger
// 6. Emitir evento: payment.confirmed
```

### 3.4 Estados de Pago

```
┌──────────┐     ┌───────────┐     ┌───────────┐
│ PENDING  │────>│ APPROVED  │────>│ COMPLETED │
└──────────┘     └───────────┘     └───────────┘
      │                │
      │                ▼
      │          ┌───────────┐
      └─────────>│ CANCELLED │
                 └───────────┘
      │                │
      │                ▼
      │          ┌───────────┐
      └─────────>│  FAILED   │
                 └───────────┘
      │                │
      │                ▼
      │          ┌───────────┐
      └─────────>│  EXPIRED  │
                 └───────────┘
```

---

## 4. Flujo de Comprobantes (Receipts)

### 4.1 Diagrama de Flujo

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        RECEIPT INGESTION FLOW                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Cliente envía imagen/PDF por WhatsApp                                       │
│         │                                                                    │
│         ▼                                                                    │
│  ┌─────────────────┐                                                         │
│  │ 1. Guardar File │  → S3/R2 bucket (file_ref)                             │
│  └────────┬────────┘                                                         │
│           │                                                                  │
│           ▼                                                                  │
│  ┌─────────────────┐     ┌──────────────────┐                               │
│  │ 2. Extraer Info │────>│ OCR/Vision API   │                               │
│  │    (opcional)   │     │ (monto, fecha)   │                               │
│  └────────┬────────┘     └──────────────────┘                               │
│           │                                                                  │
│           ▼                                                                  │
│  ┌─────────────────┐                                                         │
│  │ 3. Crear Receipt│  status: pending_review                                │
│  │    (draft)      │  extracted_amount: X | null                            │
│  └────────┬────────┘  declared_amount: null                                 │
│           │                                                                  │
│           ▼                                                                  │
│  ┌─────────────────────────────────────────────┐                            │
│  │ 4. ¿Hay orden pendiente única?              │                            │
│  └─────────────────────────────────────────────┘                            │
│           │                                                                  │
│     ┌─────┴─────┐                                                           │
│     ▼           ▼                                                            │
│  ┌──────┐   ┌──────────────────────────────────┐                            │
│  │ SÍ   │   │ NO (múltiples o ninguna)         │                            │
│  └──┬───┘   └──────────────┬───────────────────┘                            │
│     │                      │                                                 │
│     │                      ▼                                                 │
│     │       ┌──────────────────────────────────┐                            │
│     │       │ Agente pregunta:                 │                            │
│     │       │ "¿A qué pedido corresponde?"     │                            │
│     │       │ - Lista de pedidos pendientes    │                            │
│     │       │ - "Es un pago a cuenta"          │                            │
│     │       └──────────────┬───────────────────┘                            │
│     │                      │                                                 │
│     └──────────────────────┘                                                 │
│                      │                                                       │
│                      ▼                                                       │
│  ┌─────────────────────────────────────────────┐                            │
│  │ 5. Confirmar monto con cliente              │                            │
│  │    (si extracted != declared)               │                            │
│  └─────────────────────────────────────────────┘                            │
│                      │                                                       │
│                      ▼                                                       │
│  ┌─────────────────────────────────────────────┐                            │
│  │ 6. Aplicar pago (requiere confirmación)     │                            │
│  │    - Actualizar Order o CustomerBalance     │                            │
│  │    - Crear LedgerEntry                      │                            │
│  │    - Marcar Receipt como applied            │                            │
│  └─────────────────────────────────────────────┘                            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Schema de Receipt

```typescript
interface Receipt {
  id: string;
  workspaceId: string;
  customerId: string;
  sessionId?: string;

  // File storage
  fileRef: string;           // S3/R2 key
  fileType: 'image' | 'pdf';
  fileUrl?: string;          // Signed URL (temporal)

  // Extraction
  extractedAmount?: number;  // OCR/Vision extracted
  extractedDate?: Date;
  extractionConfidence?: number;  // 0-1

  // Declaration
  declaredAmount?: number;   // Cliente declaró
  declaredDate?: Date;

  // Application
  appliedAmount?: number;    // Monto final aplicado
  orderId?: string;          // Si aplica a orden específica
  ledgerEntryId?: string;    // Referencia al ledger

  // Status
  status: 'pending_review' | 'confirmed' | 'applied' | 'rejected';
  rejectionReason?: string;

  // Audit
  uploadedAt: Date;
  confirmedAt?: Date;
  confirmedBy?: string;
  appliedAt?: Date;
}
```

### 4.3 Extracción de Monto (Opcional)

```typescript
// Para V1, extracción manual (cliente declara monto)
// Para V2, integrar con:
// - Google Cloud Vision API
// - AWS Textract
// - OpenAI Vision

interface AmountExtractionResult {
  success: boolean;
  amount?: number;
  currency?: string;
  date?: string;
  confidence: number;
  rawText?: string;
}

// Por ahora: el agente pregunta el monto
// "Recibí tu comprobante. ¿De cuánto es el pago?"
```

---

## 5. Modelo de Deuda

### 5.1 Ledger vs Balance Simple

| Aspecto | Ledger (Elegido) | Balance Simple |
|---------|------------------|----------------|
| **Trazabilidad** | Cada movimiento registrado | Solo saldo final |
| **Auditoría** | Completa | Limitada |
| **Pagos parciales** | Nativos | Complejo |
| **Complejidad** | Media | Baja |
| **Reconciliación** | Fácil | Difícil |

**Decisión: Usar Ledger** para máxima trazabilidad y flexibilidad.

### 5.2 Schema del Ledger

```typescript
interface LedgerEntry {
  id: string;
  workspaceId: string;
  customerId: string;

  // Tipo de movimiento
  type: 'debit' | 'credit';
  // debit = cliente debe (orden creada)
  // credit = cliente pagó (pago recibido)

  // Monto
  amount: number;  // Siempre positivo
  currency: string;

  // Balance después de este movimiento
  balanceAfter: number;

  // Referencia
  referenceType: 'Order' | 'Payment' | 'Receipt' | 'Adjustment' | 'WriteOff';
  referenceId: string;

  // Descripción
  description: string;

  // Audit
  createdAt: Date;
  createdBy?: string;  // userId o 'system' o 'agent'

  // Metadata
  metadata?: Record<string, unknown>;
}
```

### 5.3 Ejemplos de Movimientos

```
Cliente: Juan Pérez (ID: cust-001)
═══════════════════════════════════════════════════════════════════════════════
Fecha       │ Tipo   │ Monto    │ Balance  │ Referencia      │ Descripción
═══════════════════════════════════════════════════════════════════════════════
2024-01-15  │ DEBIT  │ $5,000   │ $5,000   │ Order/ORD-001   │ Pedido #001
2024-01-16  │ CREDIT │ $3,000   │ $2,000   │ Payment/PAY-001 │ Pago MP
2024-01-18  │ DEBIT  │ $8,000   │ $10,000  │ Order/ORD-002   │ Pedido #002
2024-01-20  │ CREDIT │ $5,000   │ $5,000   │ Receipt/REC-001 │ Transferencia
2024-01-22  │ CREDIT │ $2,000   │ $3,000   │ Payment/PAY-002 │ Pago parcial MP
═══════════════════════════════════════════════════════════════════════════════
                                  Saldo actual: $3,000 (cliente DEBE)
```

### 5.4 Aplicar Pagos Parciales

```typescript
// Estrategia: FIFO (First In, First Out)
// El pago se aplica a las deudas más antiguas primero

async function applyPayment(
  customerId: string,
  amount: number,
  paymentRef: { type: string; id: string }
): Promise<LedgerEntry[]> {
  const entries: LedgerEntry[] = [];

  // 1. Obtener balance actual
  const currentBalance = await getCustomerBalance(customerId);

  // 2. Crear entry de crédito
  const creditEntry = await createLedgerEntry({
    customerId,
    type: 'credit',
    amount,
    balanceAfter: currentBalance - amount,
    referenceType: paymentRef.type,
    referenceId: paymentRef.id,
    description: `Pago recibido`,
  });
  entries.push(creditEntry);

  // 3. Marcar órdenes como pagadas (FIFO)
  const unpaidOrders = await getUnpaidOrders(customerId);
  let remaining = amount;

  for (const order of unpaidOrders) {
    if (remaining <= 0) break;

    const orderDebt = order.total - order.paidAmount;
    const payment = Math.min(remaining, orderDebt);

    await updateOrderPaidAmount(order.id, order.paidAmount + payment);

    if (order.paidAmount + payment >= order.total) {
      await markOrderAsPaid(order.id);
    }

    remaining -= payment;
  }

  // 4. Si queda saldo a favor, queda como crédito
  // (balanceAfter será negativo = cliente tiene saldo a favor)

  return entries;
}
```

### 5.5 Consulta de Deuda

```typescript
interface CustomerDebtSummary {
  customerId: string;
  currentBalance: number;      // >0 = debe, <0 = saldo a favor
  lastActivityAt: Date;
  unpaidOrders: Array<{
    orderId: string;
    orderNumber: string;
    total: number;
    paidAmount: number;
    pendingAmount: number;
    createdAt: Date;
    daysOverdue: number;
  }>;
  recentPayments: Array<{
    paymentId: string;
    amount: number;
    method: string;
    createdAt: Date;
  }>;
}
```

---

## 6. Jobs y Recordatorios

### 6.1 Configuración por Workspace

```typescript
interface WorkspaceDebtSettings {
  // Recordatorios automáticos
  debtReminders: {
    enabled: boolean;
    // Cuándo enviar (días desde última actividad)
    firstReminderDays: number;   // Default: 3
    secondReminderDays: number;  // Default: 7
    thirdReminderDays: number;   // Default: 14
    // Límite de recordatorios
    maxReminders: number;        // Default: 3
    // Horario de envío
    sendBetweenHours: [number, number]; // Default: [9, 20]
    // Template
    messageTemplate: string;
  };

  // Configuración de deuda
  debtConfig: {
    // Máxima deuda permitida para seguir comprando
    maxDebtAmount?: number;
    // Días de gracia antes de bloquear
    gracePeriodDays: number;     // Default: 30
    // Auto-bloquear cliente con deuda vencida
    autoBlockOnOverdue: boolean;
  };
}
```

### 6.2 Job de Recordatorios

```typescript
// Ejecuta cada hora
// Queue: debt-reminders

interface DebtReminderJob {
  workspaceId: string;
}

async function processDebtReminders(workspaceId: string) {
  const settings = await getWorkspaceDebtSettings(workspaceId);
  if (!settings.debtReminders.enabled) return;

  const now = new Date();
  const hour = now.getHours();

  // Solo enviar en horario permitido
  const [startHour, endHour] = settings.debtReminders.sendBetweenHours;
  if (hour < startHour || hour >= endHour) return;

  // Buscar clientes con deuda que necesitan recordatorio
  const customersWithDebt = await prisma.customer.findMany({
    where: {
      workspaceId,
      // Tiene balance positivo (debe)
      // lastReminderAt < threshold
    },
    include: {
      ledgerEntries: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  for (const customer of customersWithDebt) {
    const daysSinceLastActivity = calculateDaysSince(
      customer.ledgerEntries[0]?.createdAt
    );
    const remindersSent = customer.debtReminderCount || 0;

    // Determinar si necesita recordatorio
    const shouldRemind = shouldSendReminder(
      daysSinceLastActivity,
      remindersSent,
      settings.debtReminders
    );

    if (shouldRemind && remindersSent < settings.debtReminders.maxReminders) {
      await queueDebtReminder({
        workspaceId,
        customerId: customer.id,
        reminderNumber: remindersSent + 1,
      });
    }
  }
}
```

### 6.3 Envío de Recordatorio

```typescript
// Queue: send-debt-reminder

async function sendDebtReminder(job: {
  workspaceId: string;
  customerId: string;
  reminderNumber: number;
}) {
  const customer = await getCustomer(job.customerId);
  const debt = await getCustomerDebtSummary(job.customerId);
  const settings = await getWorkspaceDebtSettings(job.workspaceId);

  // Construir mensaje
  const message = buildDebtReminderMessage(
    settings.debtReminders.messageTemplate,
    {
      customerName: customer.firstName,
      totalDebt: debt.currentBalance,
      oldestOrderDate: debt.unpaidOrders[0]?.createdAt,
      orderCount: debt.unpaidOrders.length,
    }
  );

  // Enviar por WhatsApp
  await sendWhatsAppMessage(customer.phone, message);

  // Registrar envío
  await prisma.customer.update({
    where: { id: job.customerId },
    data: {
      lastDebtReminderAt: new Date(),
      debtReminderCount: job.reminderNumber,
    },
  });

  // Audit log
  await createAuditLog({
    workspaceId: job.workspaceId,
    action: 'debt.reminder_sent',
    resourceType: 'Customer',
    resourceId: job.customerId,
    metadata: {
      reminderNumber: job.reminderNumber,
      debtAmount: debt.currentBalance,
    },
  });
}
```

### 6.4 Template de Mensaje Default

```
Hola {{customerName}}! 👋

Te recordamos que tenés un saldo pendiente de ${{totalDebt}}.

{{#if orderCount > 1}}
Corresponde a {{orderCount}} pedidos.
{{/if}}

Podés pagar por MercadoPago o transferencia.
¿Te genero un link de pago? 💳

Cualquier duda, estamos para ayudarte.
```

---

## 7. Tools del Agente

### 7.1 Catálogo de Tools de Pago

| Tool | Categoría | Descripción | Requiere Confirmación |
|------|-----------|-------------|----------------------|
| `create_payment_link` | mutation | Genera link MP para orden/monto | NO |
| `get_payment_status` | query | Consulta estado de un pago | NO |
| `process_receipt` | mutation | Registra comprobante enviado | NO |
| `apply_receipt_to_order` | mutation | Aplica comprobante a orden | SÍ |
| `apply_payment_to_balance` | mutation | Aplica pago a cuenta | SÍ |
| `get_customer_balance` | query | Consulta saldo/deuda | NO |
| `get_unpaid_orders` | query | Lista órdenes impagas | NO |

### 7.2 Schemas de Tools

```typescript
// ═══════════════════════════════════════════════════════════════════════════════
// create_payment_link
// ═══════════════════════════════════════════════════════════════════════════════

const CreatePaymentLinkInput = z.object({
  orderId: z.string().uuid().optional()
    .describe('ID de la orden a pagar. Si no se especifica, es pago a cuenta.'),
  amount: z.number().int().positive().optional()
    .describe('Monto en centavos. Requerido si no hay orderId.'),
  description: z.string().max(200).optional()
    .describe('Descripción del pago'),
});

interface CreatePaymentLinkOutput {
  success: boolean;
  data: {
    paymentId: string;
    paymentUrl: string;
    amount: number;
    expiresAt: string;
    message: string;  // "Te paso el link de pago: {url}"
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// process_receipt
// ═══════════════════════════════════════════════════════════════════════════════

const ProcessReceiptInput = z.object({
  fileRef: z.string()
    .describe('Referencia al archivo subido (de WhatsApp)'),
  declaredAmount: z.number().int().positive().optional()
    .describe('Monto declarado por el cliente'),
  declaredDate: z.string().datetime().optional()
    .describe('Fecha del pago según cliente'),
});

interface ProcessReceiptOutput {
  success: boolean;
  data: {
    receiptId: string;
    status: 'pending_review';
    matchingOrders: Array<{
      orderId: string;
      orderNumber: string;
      pendingAmount: number;
    }>;
    needsOrderSelection: boolean;
    message: string;  // "Recibí el comprobante. ¿A qué pedido corresponde?"
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// apply_receipt_to_order
// ═══════════════════════════════════════════════════════════════════════════════

const ApplyReceiptToOrderInput = z.object({
  receiptId: z.string().uuid()
    .describe('ID del comprobante a aplicar'),
  orderId: z.string().uuid()
    .describe('ID de la orden destino'),
  amount: z.number().int().positive()
    .describe('Monto a aplicar'),
});

interface ApplyReceiptToOrderOutput {
  success: boolean;
  data: {
    applied: boolean;
    orderNumber: string;
    orderPaidAmount: number;
    orderPendingAmount: number;
    isFullyPaid: boolean;
    message: string;  // "Listo! Apliqué $X al pedido #Y. Saldo pendiente: $Z"
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// apply_payment_to_balance
// ═══════════════════════════════════════════════════════════════════════════════

const ApplyPaymentToBalanceInput = z.object({
  receiptId: z.string().uuid().optional()
    .describe('ID del comprobante (si aplica)'),
  amount: z.number().int().positive()
    .describe('Monto a acreditar'),
  description: z.string().max(200)
    .describe('Descripción del pago'),
});

interface ApplyPaymentToBalanceOutput {
  success: boolean;
  data: {
    ledgerEntryId: string;
    previousBalance: number;
    newBalance: number;
    ordersSettled: string[];  // Órdenes que quedaron pagadas
    message: string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// get_customer_balance
// ═══════════════════════════════════════════════════════════════════════════════

const GetCustomerBalanceInput = z.object({});

interface GetCustomerBalanceOutput {
  success: boolean;
  data: {
    currentBalance: number;     // >0 debe, <0 saldo a favor
    hasDebt: boolean;
    hasCreditBalance: boolean;
    unpaidOrderCount: number;
    oldestUnpaidOrder?: {
      orderNumber: string;
      amount: number;
      daysOld: number;
    };
    recentPayments: Array<{
      amount: number;
      date: string;
      method: string;
    }>;
    formattedMessage: string;   // Para responder al cliente
  };
}
```

### 7.3 Flujo del Agente con Pagos

```
Cliente: "Ya te transferí"
    │
    ▼
Agente: process_receipt(fileRef, declaredAmount: null)
    │
    ▼
Sistema: "Recibí el comprobante. ¿De cuánto fue el pago?"
    │
    ▼
Cliente: "5000 pesos"
    │
    ▼
Agente: get_unpaid_orders()
    │
    ▼
Sistema: matchingOrders = [ORD-001 ($5000), ORD-002 ($3000)]
    │
    ▼
Agente: "Tenés 2 pedidos pendientes:
         - #001 por $5.000
         - #002 por $3.000
         ¿A cuál aplico el pago?"
    │
    ▼
Cliente: "Al pedido 001"
    │
    ▼
Agente: apply_receipt_to_order(receiptId, orderId: ORD-001, amount: 5000)
    │
    ▼
Sistema: "Listo! Pedido #001 pagado. ¡Gracias!"
```

---

## 8. UI de Configuración

### 8.1 Estructura de Navegación

```
Dashboard
└── Configuración
    └── Aplicaciones (antes "WhatsApp")
        ├── WhatsApp
        │   ├── Estado: Conectado ✓
        │   ├── Número: +54 9 11 5555-0000
        │   └── [Desconectar]
        │
        └── Mercado Pago
            ├── Estado: No conectado
            └── [Conectar con Mercado Pago]
```

### 8.2 Wireframe - Página de Aplicaciones

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ← Configuración                                                             │
│                                                                              │
│  ╔═══════════════════════════════════════════════════════════════════════╗  │
│  ║  APLICACIONES CONECTADAS                                              ║  │
│  ╚═══════════════════════════════════════════════════════════════════════╝  │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  📱 WhatsApp Business                                                  │  │
│  │                                                                        │  │
│  │  Estado: ● Conectado                                                  │  │
│  │  Número: +54 9 11 5555-0000                                           │  │
│  │  Proveedor: Infobip                                                   │  │
│  │  Mensajes hoy: 247                                                    │  │
│  │                                                                        │  │
│  │  [Ver detalles]                              [⚙️ Configurar]          │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  💳 Mercado Pago                                                       │  │
│  │                                                                        │  │
│  │  Estado: ○ No conectado                                               │  │
│  │                                                                        │  │
│  │  Conectá tu cuenta de Mercado Pago para:                              │  │
│  │  • Generar links de pago automáticos                                  │  │
│  │  • Recibir notificaciones de pagos                                    │  │
│  │  • Gestionar cobros desde el chat                                     │  │
│  │                                                                        │  │
│  │  ┌─────────────────────────────────────────┐                          │  │
│  │  │  🔗 Conectar con Mercado Pago           │                          │  │
│  │  └─────────────────────────────────────────┘                          │  │
│  │                                                                        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  📊 Próximamente                                                       │  │
│  │                                                                        │  │
│  │  • Google Sheets (sincronizar pedidos)                                │  │
│  │  • Contabilium (facturación)                                          │  │
│  │  • Tienda Nube (catálogo)                                             │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.3 Wireframe - MP Conectado

```
┌───────────────────────────────────────────────────────────────────────┐
│  💳 Mercado Pago                                                       │
│                                                                        │
│  Estado: ● Conectado                                                  │
│  Cuenta: comercio@email.com                                           │
│  User ID: 123456789                                                   │
│  Conectado el: 15/01/2024                                             │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  Estadísticas del mes                                            │ │
│  │                                                                   │ │
│  │  Links generados: 45                                             │ │
│  │  Pagos recibidos: 38                                             │ │
│  │  Monto cobrado: $125.400                                         │ │
│  │  Tasa de conversión: 84%                                         │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  ⚙️ Configuración                                                      │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  Expiración de links: [60 minutos ▼]                             │ │
│  │  Notificar pagos por email: [✓]                                  │ │
│  │  Webhook URL: https://api.nexova.com/webhooks/mp/xxx             │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  [Desconectar cuenta]                                                 │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 9. Schemas y Contratos

### 9.1 Prisma Schema Additions

```prisma
// ═══════════════════════════════════════════════════════════════════════════════
// MERCADO PAGO CONNECTION
// ═══════════════════════════════════════════════════════════════════════════════

model WorkspaceIntegration {
  id            String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId   String    @map("workspace_id") @db.Uuid
  provider      String    @db.VarChar(50)  // 'mercadopago', 'google_sheets', etc.
  status        String    @default("disconnected") @db.VarChar(20)

  // OAuth tokens (encrypted)
  accessTokenEnc  String?   @map("access_token_enc") @db.Text
  accessTokenIv   String?   @map("access_token_iv") @db.VarChar(32)
  refreshTokenEnc String?   @map("refresh_token_enc") @db.Text
  refreshTokenIv  String?   @map("refresh_token_iv") @db.VarChar(32)
  tokenExpiresAt  DateTime? @map("token_expires_at")

  // Provider-specific data
  externalUserId  String?   @map("external_user_id") @db.VarChar(100)
  externalEmail   String?   @map("external_email") @db.VarChar(255)
  providerData    Json      @default("{}") @map("provider_data")

  // Timestamps
  connectedAt   DateTime? @map("connected_at")
  disconnectedAt DateTime? @map("disconnected_at")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")

  // Relations
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, provider])
  @@map("workspace_integrations")
}

// ═══════════════════════════════════════════════════════════════════════════════
// RECEIPTS
// ═══════════════════════════════════════════════════════════════════════════════

model Receipt {
  id            String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId   String    @map("workspace_id") @db.Uuid
  customerId    String    @map("customer_id") @db.Uuid
  sessionId     String?   @map("session_id") @db.Uuid

  // File
  fileRef       String    @map("file_ref") @db.VarChar(500)
  fileType      String    @map("file_type") @db.VarChar(20)
  fileSizeBytes Int?      @map("file_size_bytes")

  // Extraction (from OCR/Vision)
  extractedAmount     Int?      @map("extracted_amount")
  extractedDate       DateTime? @map("extracted_date")
  extractedConfidence Float?    @map("extracted_confidence")
  extractedRawText    String?   @map("extracted_raw_text") @db.Text

  // Declaration (from customer)
  declaredAmount      Int?      @map("declared_amount")
  declaredDate        DateTime? @map("declared_date")

  // Application
  appliedAmount       Int?      @map("applied_amount")
  orderId             String?   @map("order_id") @db.Uuid
  ledgerEntryId       String?   @map("ledger_entry_id") @db.Uuid

  // Status
  status              String    @default("pending_review") @db.VarChar(20)
  rejectionReason     String?   @map("rejection_reason") @db.VarChar(500)

  // Audit
  uploadedAt          DateTime  @default(now()) @map("uploaded_at")
  confirmedAt         DateTime? @map("confirmed_at")
  confirmedBy         String?   @map("confirmed_by") @db.Uuid
  appliedAt           DateTime? @map("applied_at")
  appliedBy           String?   @map("applied_by") @db.Uuid

  createdAt           DateTime  @default(now()) @map("created_at")
  updatedAt           DateTime  @updatedAt @map("updated_at")

  // Relations
  workspace     Workspace     @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  customer      Customer      @relation(fields: [customerId], references: [id])
  order         Order?        @relation(fields: [orderId], references: [id])
  ledgerEntry   LedgerEntry?  @relation(fields: [ledgerEntryId], references: [id])

  @@index([workspaceId, customerId])
  @@index([workspaceId, status])
  @@map("receipts")
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEDGER ENTRIES
// ═══════════════════════════════════════════════════════════════════════════════

model LedgerEntry {
  id            String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId   String    @map("workspace_id") @db.Uuid
  customerId    String    @map("customer_id") @db.Uuid

  // Movement type
  type          String    @db.VarChar(10)  // 'debit' | 'credit'

  // Amount (always positive)
  amount        Int
  currency      String    @default("ARS") @db.VarChar(3)

  // Balance after this entry
  balanceAfter  Int       @map("balance_after")

  // Reference
  referenceType String    @map("reference_type") @db.VarChar(50)
  referenceId   String    @map("reference_id") @db.Uuid

  // Description
  description   String    @db.VarChar(500)

  // Metadata
  metadata      Json      @default("{}")

  // Audit
  createdAt     DateTime  @default(now()) @map("created_at")
  createdBy     String?   @map("created_by") @db.VarChar(100)

  // Relations
  workspace     Workspace   @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  customer      Customer    @relation(fields: [customerId], references: [id])
  receipts      Receipt[]

  @@index([workspaceId, customerId, createdAt])
  @@index([referenceType, referenceId])
  @@map("ledger_entries")
}
```

### 9.2 API Endpoints

```typescript
// ═══════════════════════════════════════════════════════════════════════════════
// MERCADO PAGO OAUTH
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/v1/integrations/mercadopago/auth-url
// Returns: { url: string } - Redirect URL for OAuth

// GET /api/v1/integrations/mercadopago/callback?code=xxx&state=xxx
// OAuth callback - exchanges code for tokens

// DELETE /api/v1/integrations/mercadopago
// Disconnects MP account

// GET /api/v1/integrations/mercadopago/status
// Returns connection status and stats

// ═══════════════════════════════════════════════════════════════════════════════
// PAYMENTS
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/v1/payments/create-link
// Creates MP payment preference

// POST /api/v1/webhooks/mercadopago
// Receives MP IPN notifications

// GET /api/v1/payments/:id
// Get payment details

// ═══════════════════════════════════════════════════════════════════════════════
// RECEIPTS
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/v1/receipts/upload
// Upload receipt file (multipart)

// POST /api/v1/receipts/:id/apply
// Apply receipt to order or balance

// GET /api/v1/receipts
// List receipts (with filters)

// ═══════════════════════════════════════════════════════════════════════════════
// LEDGER
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/v1/customers/:id/balance
// Get customer balance and debt summary

// GET /api/v1/customers/:id/ledger
// Get ledger entries (paginated)

// POST /api/v1/ledger/adjustment
// Create manual adjustment (admin only)
```

### 9.3 Events Emitidos

```typescript
// Payment events
'payment.link_created'     // Link de pago generado
'payment.completed'        // Pago confirmado
'payment.failed'           // Pago falló
'payment.expired'          // Link expiró

// Receipt events
'receipt.uploaded'         // Comprobante subido
'receipt.applied'          // Comprobante aplicado
'receipt.rejected'         // Comprobante rechazado

// Ledger events
'ledger.debit_created'     // Nueva deuda (orden)
'ledger.credit_created'    // Nuevo crédito (pago)
'ledger.balance_zero'      // Cliente saldó deuda

// Debt events
'debt.reminder_sent'       // Recordatorio enviado
'debt.customer_blocked'    // Cliente bloqueado por deuda
'debt.threshold_exceeded'  // Supera límite de deuda
```

---

## 10. Checklist de Implementación

### Fase 1: Infraestructura
- [ ] Agregar modelos Prisma (WorkspaceIntegration, Receipt, LedgerEntry)
- [ ] Migración de base de datos
- [ ] Configurar bucket S3/R2 para receipts

### Fase 2: Mercado Pago
- [ ] Implementar OAuth flow
- [ ] Crear servicio de generación de links
- [ ] Implementar webhook handler
- [ ] Agregar encriptación de tokens

### Fase 3: Receipts
- [ ] Endpoint de upload
- [ ] Servicio de procesamiento
- [ ] Integración con agente (tools)

### Fase 4: Ledger
- [ ] Implementar LedgerEngine
- [ ] Lógica de aplicación FIFO
- [ ] Consultas de balance

### Fase 5: Jobs
- [ ] Job de recordatorios
- [ ] Configuración por workspace
- [ ] Templates de mensaje

### Fase 6: UI Dashboard
- [ ] Página "Aplicaciones"
- [ ] Flujo de conexión MP
- [ ] Vista de receipts pendientes
- [ ] Reporte de deudas

### Fase 7: Agent Tools
- [ ] create_payment_link
- [ ] process_receipt
- [ ] apply_receipt_to_order
- [ ] apply_payment_to_balance
- [ ] get_customer_balance

---

## 11. Consideraciones de Seguridad

1. **Tokens MP**: Encriptados con AES-256, IV único por registro
2. **Webhooks**: Verificación HMAC obligatoria
3. **Receipts**: Validación de tipo de archivo, tamaño máximo
4. **Ledger**: Solo admins pueden crear ajustes manuales
5. **Audit**: Todo movimiento de dinero queda registrado
6. **Confirmaciones**: apply_receipt requiere confirmación del agente

---

## 12. Próximos Pasos

Una vez aprobado este diseño:
1. Crear migración Prisma con nuevos modelos
2. Implementar `packages/integrations/src/mercadopago/`
3. Crear tools de pago en `packages/agent-runtime/src/tools/retail/payment.tools.ts`
4. Implementar UI de aplicaciones en dashboard
5. Configurar variables de entorno MP (client_id, client_secret)
