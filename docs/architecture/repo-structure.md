# ENTREGABLE 3: Estructura del Repositorio

## Visión General

Monorepo con **pnpm workspaces** + **TypeScript Project References** para builds incrementales.

```
nexova/
├── .github/                          # CI/CD workflows
├── .husky/                           # Git hooks
├── apps/                             # Aplicaciones deployables
│   ├── api/                          # Fastify REST API
│   │   ├── src/
│   │   │   ├── main.ts               # Entry point, Fastify setup
│   │   │   ├── plugins/
│   │   │   │   ├── prisma.plugin.ts
│   │   │   │   ├── auth.plugin.ts
│   │   │   │   ├── error.plugin.ts
│   │   │   │   └── realtime.plugin.ts
│   │   │   ├── routes/
│   │   │   │   └── v1/
│   │   │   │       ├── auth.routes.ts
│   │   │   │       ├── workspace.routes.ts
│   │   │   │       ├── admin.routes.ts
│   │   │   │       ├── health.routes.ts
│   │   │   │       ├── webhook.routes.ts
│   │   │   │       ├── conversations.routes.ts
│   │   │   │       ├── integrations.routes.ts
│   │   │   │       ├── quick-actions.routes.ts
│   │   │   │       ├── customers.routes.ts
│   │   │   │       ├── products.routes.ts
│   │   │   │       ├── categories.routes.ts
│   │   │   │       ├── orders.routes.ts
│   │   │   │       ├── uploads.routes.ts
│   │   │   │       ├── analytics.routes.ts
│   │   │   │       └── notifications.routes.ts
│   │   │   ├── services/
│   │   │   │   ├── analytics/
│   │   │   │   └── quick-action/
│   │   │   ├── middleware/
│   │   │   ├── utils/
│   │   │   └── types/
│   │   ├── test/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── Dockerfile
│   │
│   ├── worker/                       # ═══════════════════════════════════
│   │   ├── src/
│   │   │   ├── main.ts               # Worker bootstrap (incl. AgentWorker)
│   │   │   └── jobs/
│   │   │       ├── debt-reminder.job.ts
│   │   │       ├── outbox-relay.job.ts
│   │   │       ├── scheduled.job.ts
│   │   │       └── webhook-retry.job.ts
│   │   ├── test/
│   │   ├── package.json
│   │   ├── tsconfig.json             # References: core, retail, agent-runtime, integrations
│   │   └── Dockerfile
│   │
│   └── dashboard/                    # React SPA
├── packages/                         # Módulos internos
│   │
│   ├── shared/                       # ═══════════════════════════════════
│   │   │                             # NINGUNA dependencia de otros packages
│   │   ├── src/
│   │   │   ├── index.ts              # Public exports
│   │   │   ├── constants/            # QUEUES, reglas, estados
│   │   │   ├── schemas/              # Zod schemas (source of truth)
│   │   │   └── types/                # Tipos compartidos
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── core/                         # ═══════════════════════════════════
│   │   │                             # Depends on: shared
│   │   ├── src/
│   │   │   ├── index.ts              # Public exports
│   │   │   ├── auth/
│   │   │   ├── tenancy/
│   │   │   ├── rbac/
│   │   │   ├── ledger/
│   │   │   ├── catalog/
│   │   │   ├── orders/
│   │   │   ├── crypto/
│   │   │   ├── queue/
│   │   │   ├── observability/
│   │   │   └── idempotency/
│   │   ├── test/
│   │   ├── package.json
│   │   └── tsconfig.json             # References: shared
│   │
│   ├── retail/                       # ═══════════════════════════════════
│   │   │                             # Placeholder (sin src por ahora)
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── integrations/                 # ═══════════════════════════════════
│   │   │                             # Depends on: shared, core
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── whatsapp/
│   │   │   │   ├── infobip.client.ts
│   │   │   │   └── index.ts
│   │   │   ├── mercadopago/
│   │   │   │   ├── mercadopago.client.ts
│   │   │   │   ├── webhook.handler.ts
│   │   │   │   ├── oauth.service.ts
│   │   │   │   ├── integration.service.ts
│   │   │   │   ├── crypto.utils.ts
│   │   │   │   └── types.ts
│   │   │   └── arca/
│   │   │       ├── arca.client.ts
│   │   │       ├── integration.service.ts
│   │   │       ├── types.ts
│   │   │       └── index.ts
│   │   ├── test/
│   │   ├── package.json
│   │   └── tsconfig.json             # References: shared, core
│   │
│   └── agent-runtime/                # ═══════════════════════════════════
│       │                             # Depends on: shared, core, integrations
│       ├── src/
│       │   ├── index.ts
│       │   ├── core/
│       │   │   ├── agent.ts
│       │   │   ├── state-machine.ts
│       │   │   ├── memory-manager.ts
│       │   │   ├── conversation-router.ts
│       │   │   └── orchestrator.ts
│       │   ├── tools/
│       │   │   ├── base.ts
│       │   │   ├── registry.ts
│       │   │   └── retail/            # Tools del dominio comercio
│       │   ├── prompts/
│       │   │   └── retail-system.ts
│       │   ├── utils/
│       │   │   ├── notifications.ts
│       │   │   ├── orders.ts
│       │   │   └── file-uploader.ts
│       │   ├── worker/
│       │   │   ├── agent-worker.ts
│       │   │   └── start.ts
│       │   └── types/
│       │       └── index.ts
│       ├── test/
│       ├── package.json
│       └── tsconfig.json             # References: shared, core, integrations
│
├── prisma/                           # Schema y migrations (centralizado)
├── scripts/                          # Scripts de desarrollo y deploy
├── docker/                           # Dockerfiles y compose
├── package.json                      # Root workspace
├── pnpm-workspace.yaml               # Workspace config
├── tsconfig.base.json                # TS config base
├── turbo.json                        # Turborepo config
└── .eslintrc.js                      # ESLint con boundary rules
```

---

## Árbol Detallado

```
nexova/
│
├── .github/
│   └── workflows/
│
├── .husky/
│
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── plugins/
│   │   │   │   ├── prisma.plugin.ts
│   │   │   │   ├── auth.plugin.ts
│   │   │   │   ├── error.plugin.ts
│   │   │   │   └── realtime.plugin.ts
│   │   │   ├── routes/
│   │   │   │   └── v1/
│   │   │   │       ├── auth.routes.ts
│   │   │   │       ├── workspace.routes.ts
│   │   │   │       ├── admin.routes.ts
│   │   │   │       ├── health.routes.ts
│   │   │   │       ├── webhook.routes.ts
│   │   │   │       ├── conversations.routes.ts
│   │   │   │       ├── integrations.routes.ts
│   │   │   │       ├── quick-actions.routes.ts
│   │   │   │       ├── customers.routes.ts
│   │   │   │       ├── products.routes.ts
│   │   │   │       ├── categories.routes.ts
│   │   │   │       ├── orders.routes.ts
│   │   │   │       ├── uploads.routes.ts
│   │   │   │       ├── analytics.routes.ts
│   │   │   │       └── notifications.routes.ts
│   │   │   ├── services/
│   │   │   │   ├── analytics/
│   │   │   │   └── quick-action/
│   │   │   ├── middleware/
│   │   │   ├── utils/
│   │   │   └── types/
│   │   ├── test/
│   │   └── Dockerfile
│   │
│   ├── worker/
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   └── jobs/
│   │   │       ├── debt-reminder.job.ts
│   │   │       ├── outbox-relay.job.ts
│   │   │       ├── scheduled.job.ts
│   │   │       └── webhook-retry.job.ts
│   │   ├── test/
│   │   └── Dockerfile
│   │
│   └── dashboard/
│       ├── src/
│       ├── public/
│       ├── index.html
│       ├── vite.config.ts
│       ├── tailwind.config.js
│       └── postcss.config.js
│
├── packages/
│   ├── shared/
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── constants/
│   │   │   ├── schemas/
│   │   │   └── types/
│   │   └── tsconfig.json
│   │
│   ├── core/
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── auth/
│   │   │   ├── tenancy/
│   │   │   ├── rbac/
│   │   │   ├── ledger/
│   │   │   ├── catalog/
│   │   │   ├── orders/
│   │   │   ├── crypto/
│   │   │   ├── queue/
│   │   │   ├── observability/
│   │   │   └── idempotency/
│   │   └── tsconfig.json
│   │
│   ├── retail/ (placeholder)
│   │   └── tsconfig.json
│   │
│   ├── integrations/
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── whatsapp/
│   │   │   │   ├── infobip.client.ts
│   │   │   │   └── index.ts
│   │   │   ├── mercadopago/
│   │   │   │   ├── mercadopago.client.ts
│   │   │   │   ├── webhook.handler.ts
│   │   │   │   ├── oauth.service.ts
│   │   │   │   ├── integration.service.ts
│   │   │   │   ├── crypto.utils.ts
│   │   │   │   └── types.ts
│   │   │   └── arca/
│   │   │       ├── arca.client.ts
│   │   │       ├── integration.service.ts
│   │   │       ├── types.ts
│   │   │       └── index.ts
│   │   └── tsconfig.json
│   │
│   └── agent-runtime/
│       ├── src/
│       │   ├── index.ts
│       │   ├── core/
│       │   │   ├── agent.ts
│       │   │   ├── state-machine.ts
│       │   │   ├── memory-manager.ts
│       │   │   ├── conversation-router.ts
│       │   │   └── orchestrator.ts
│       │   ├── tools/
│       │   │   ├── base.ts
│       │   │   ├── registry.ts
│       │   │   └── retail/
│       │   ├── prompts/
│       │   │   └── retail-system.ts
│       │   ├── utils/
│       │   │   ├── notifications.ts
│       │   │   ├── orders.ts
│       │   │   └── file-uploader.ts
│       │   ├── worker/
│       │   │   ├── agent-worker.ts
│       │   │   └── start.ts
│       │   └── types/
│       │       └── index.ts
│       └── tsconfig.json
│
├── prisma/
├── scripts/
├── docker/
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── turbo.json
├── tsconfig.base.json
└── README.md
```


---

## Configuraciones Clave

### pnpm-workspace.yaml

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

### tsconfig.base.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true,
    "incremental": true,
    "noEmit": false,
    "outDir": "./dist",
    "rootDir": "./src",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "paths": {
      "@nexova/shared": ["./packages/shared/src"],
      "@nexova/shared/*": ["./packages/shared/src/*"],
      "@nexova/core": ["./packages/core/src"],
      "@nexova/core/*": ["./packages/core/src/*"],
      "@nexova/retail": ["./packages/retail/src"],
      "@nexova/retail/*": ["./packages/retail/src/*"],
      "@nexova/integrations": ["./packages/integrations/src"],
      "@nexova/integrations/*": ["./packages/integrations/src/*"],
      "@nexova/agent-runtime": ["./packages/agent-runtime/src"],
      "@nexova/agent-runtime/*": ["./packages/agent-runtime/src/*"]
    }
  },
  "exclude": ["node_modules", "dist", "coverage"]
}
```

### Ejemplo: packages/core/tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "references": [
    { "path": "../shared" }
  ]
}
```

### Ejemplo: packages/agent-runtime/tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "references": [
    { "path": "../shared" },
    { "path": "../core" },
    { "path": "../integrations" }
  ]
}
```

### turbo.json

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": [".env"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": ["coverage/**"]
    },
    "test:unit": {
      "dependsOn": ["build"]
    },
    "test:integration": {
      "dependsOn": ["build"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    }
  }
}
```

---

## Boundary Rules (ESLint)

### .eslintrc.js

```javascript
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: [
    '@typescript-eslint',
    'import',
    'boundaries'
  ],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'plugin:import/typescript',
    'prettier'
  ],
  settings: {
    'import/resolver': {
      typescript: {
        project: ['./tsconfig.base.json', './apps/*/tsconfig.json', './packages/*/tsconfig.json']
      }
    },
    'boundaries/elements': [
      { type: 'shared',        pattern: 'packages/shared/*' },
      { type: 'core',          pattern: 'packages/core/*' },
      { type: 'retail',        pattern: 'packages/retail/*' },
      { type: 'integrations',  pattern: 'packages/integrations/*' },
      { type: 'agent-runtime', pattern: 'packages/agent-runtime/*' },
      { type: 'api',           pattern: 'apps/api/*' },
      { type: 'worker',        pattern: 'apps/worker/*' },
      { type: 'dashboard',     pattern: 'apps/dashboard/*' }
    ],
    'boundaries/ignore': ['**/*.test.ts', '**/*.spec.ts']
  },
  rules: {
    // ══════════════════════════════════════════════════════════════════
    // BOUNDARY RULES - Enforce module dependencies
    // ══════════════════════════════════════════════════════════════════
    'boundaries/element-types': [
      'error',
      {
        default: 'disallow',
        rules: [
          // shared: NO dependencies on other packages
          {
            from: 'shared',
            allow: []
          },
          // core: only shared
          {
            from: 'core',
            allow: ['shared']
          },
          // retail: shared + core
          {
            from: 'retail',
            allow: ['shared', 'core']
          },
          // integrations: shared + core (NO retail)
          {
            from: 'integrations',
            allow: ['shared', 'core']
          },
          // agent-runtime: shared + core + integrations (retail via DI only)
          {
            from: 'agent-runtime',
            allow: ['shared', 'core', 'integrations']
          },
          // api: all packages
          {
            from: 'api',
            allow: ['shared', 'core', 'retail', 'integrations', 'agent-runtime']
          },
          // worker: all packages
          {
            from: 'worker',
            allow: ['shared', 'core', 'retail', 'integrations', 'agent-runtime']
          },
          // dashboard: only shared (for types)
          {
            from: 'dashboard',
            allow: ['shared']
          }
        ]
      }
    ],

    // ══════════════════════════════════════════════════════════════════
    // IMPORT RULES
    // ══════════════════════════════════════════════════════════════════
    'import/order': [
      'error',
      {
        'groups': [
          'builtin',
          'external',
          'internal',
          ['parent', 'sibling'],
          'index'
        ],
        'pathGroups': [
          { pattern: '@nexova/**', group: 'internal', position: 'before' }
        ],
        'pathGroupsExcludedImportTypes': ['builtin'],
        'newlines-between': 'always',
        'alphabetize': { order: 'asc', caseInsensitive: true }
      }
    ],
    'import/no-cycle': 'error',
    'import/no-self-import': 'error',
    'import/no-useless-path-segments': 'error',

    // Prohibir imports relativos fuera del módulo
    'import/no-relative-packages': 'error',

    // ══════════════════════════════════════════════════════════════════
    // TYPESCRIPT RULES
    // ══════════════════════════════════════════════════════════════════
    '@typescript-eslint/explicit-function-return-type': ['error', {
      allowExpressions: true,
      allowTypedFunctionExpressions: true
    }],
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/consistent-type-imports': ['error', {
      prefer: 'type-imports',
      fixStyle: 'inline-type-imports'
    }],
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/await-thenable': 'error'
  },
  overrides: [
    // Relax rules for test files
    {
      files: ['**/*.test.ts', '**/*.spec.ts', '**/test/**'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off'
      }
    },
    // Dashboard (React)
    {
      files: ['apps/dashboard/**/*.tsx'],
      extends: ['plugin:react/recommended', 'plugin:react-hooks/recommended'],
      settings: { react: { version: 'detect' } }
    }
  ]
};
```

---

## Estrategia para Compartir Types

### Flujo: Zod Schema → Type → DTO

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TYPE SHARING STRATEGY                                │
└─────────────────────────────────────────────────────────────────────────────┘

  packages/shared/src/schemas/order.schemas.ts   (SOURCE OF TRUTH)
                        │
                        ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  // Zod schema - validación runtime + tipos estáticos              │
  │                                                                     │
  │  export const CreateOrderSchema = z.object({                        │
  │    customerId: z.string().uuid(),                                   │
  │    items: z.array(OrderItemSchema).min(1),                          │
  │    notes: z.string().optional(),                                    │
  │  });                                                                │
  │                                                                     │
  │  // Inferir tipo automáticamente                                    │
  │  export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;  │
  └─────────────────────────────────────────────────────────────────────┘
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
     ┌─────────┐   ┌─────────┐   ┌─────────┐
     │   API   │   │ Worker  │   │Dashboard│
     │         │   │         │   │         │
     │ Valida  │   │ Valida  │   │  Solo   │
     │ input   │   │ en tool │   │  tipos  │
     └─────────┘   └─────────┘   └─────────┘
```

### Ejemplo Completo: Order Types

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// packages/shared/src/schemas/order.schemas.ts
// ═══════════════════════════════════════════════════════════════════════════

import { z } from 'zod';

// Enums
export const OrderStatusSchema = z.enum([
  'DRAFT',
  'PENDING_PAYMENT',
  'PAID',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'RETURNED'
]);

// Sub-schemas
export const OrderItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().positive(),
  notes: z.string().optional(),
});

// Input schemas (para crear/actualizar)
export const CreateOrderInputSchema = z.object({
  customerId: z.string().uuid(),
  items: z.array(OrderItemSchema).min(1),
  notes: z.string().max(500).optional(),
});

export const UpdateOrderInputSchema = z.object({
  notes: z.string().max(500).optional(),
  status: OrderStatusSchema.optional(),
});

// Output schema (respuesta completa)
export const OrderSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  customerId: z.string().uuid(),
  status: OrderStatusSchema,
  items: z.array(OrderItemSchema.extend({
    id: z.string().uuid(),
    lineTotal: z.number(),
  })),
  subtotal: z.number(),
  tax: z.number(),
  total: z.number(),
  notes: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// ═══════════════════════════════════════════════════════════════════════════
// packages/shared/src/dto/order.dto.ts
// ═══════════════════════════════════════════════════════════════════════════

import { type z } from 'zod';
import {
  type CreateOrderInputSchema,
  type UpdateOrderInputSchema,
  type OrderSchema,
  type OrderStatusSchema,
} from '../schemas/order.schemas.js';

// Tipos inferidos de los schemas
export type OrderStatus = z.infer<typeof OrderStatusSchema>;
export type CreateOrderInput = z.infer<typeof CreateOrderInputSchema>;
export type UpdateOrderInput = z.infer<typeof UpdateOrderInputSchema>;
export type Order = z.infer<typeof OrderSchema>;

// Tipos adicionales derivados
export type OrderItem = Order['items'][number];
export type OrderSummary = Pick<Order, 'id' | 'status' | 'total' | 'createdAt'>;

// ═══════════════════════════════════════════════════════════════════════════
// packages/shared/src/events/order.events.ts
// ═══════════════════════════════════════════════════════════════════════════

import { type DomainEvent } from '../types/events.js';
import { type Order, type OrderStatus } from '../dto/order.dto.js';

export interface OrderCreatedEvent extends DomainEvent {
  type: 'order.created';
  payload: {
    orderId: string;
    customerId: string;
    items: Array<{ productId: string; quantity: number }>;
    total: number;
  };
}

export interface OrderStatusChangedEvent extends DomainEvent {
  type: 'order.status_changed';
  payload: {
    orderId: string;
    previousStatus: OrderStatus;
    newStatus: OrderStatus;
  };
}

export interface OrderCancelledEvent extends DomainEvent {
  type: 'order.cancelled';
  payload: {
    orderId: string;
    reason: string;
  };
}

// Union type para todos los eventos de Order
export type OrderEvent =
  | OrderCreatedEvent
  | OrderStatusChangedEvent
  | OrderCancelledEvent;
```

### Uso en Diferentes Capas

```typescript
// apps/api/src/routes/v1/orders.routes.ts - Validación + persistencia
import { z } from 'zod';
import { type FastifyInstance } from 'fastify';

const createOrderSchema = z.object({
  // ...campos requeridos
});

export async function ordersRoutes(app: FastifyInstance): Promise<void> {
  app.post('/orders', {
    preHandler: [app.authenticate],
    schema: { body: createOrderSchema },
  }, async (request, reply) => {
    const order = await app.prisma.order.create({
      // ...persistencia con Prisma
    });
    return reply.status(201).send(order);
  });
}

// packages/agent-runtime/src/tools/retail/order.tools.ts - Tool execution
import { z } from 'zod';
import { BaseTool } from '../base.js';

const ConfirmOrderInput = z.object({
  orderId: z.string().uuid(),
});

export class ConfirmOrderTool extends BaseTool<typeof ConfirmOrderInput> {
  async execute(input, context) {
    const order = await context.prisma.order.update({
      where: { id: input.orderId, workspaceId: context.workspaceId },
      data: { status: 'accepted' },
    });
    return { success: true, data: { orderId: order.id, status: order.status } };
  }
}
```


---

## Convenciones de Imports

### Reglas

| Desde | Puede importar | Prohibido |
|-------|---------------|-----------|
| `shared` | Solo dependencias externas | Cualquier `@nexova/*` |
| `core` | `@nexova/shared` | `integrations`, `agent-runtime` |
| `integrations` | `@nexova/shared`, `@nexova/core` | `agent-runtime` |
| `agent-runtime` | `@nexova/shared`, `@nexova/core`, `@nexova/integrations` | - |
| `api` | `@nexova/shared`, `@nexova/core`, `@nexova/integrations`, `@nexova/agent-runtime` | - |
| `worker` | `@nexova/shared`, `@nexova/core`, `@nexova/integrations`, `@nexova/agent-runtime` | - |
| `dashboard` | Solo `@nexova/shared` (tipos/constantes) | `core`, `integrations`, `agent-runtime` |

### Formato de Import

```typescript
// ✅ CORRECTO - Imports ordenados y agrupados
import { type FastifyInstance } from 'fastify';        // 1. External
import { z } from 'zod';

import { type AgentProcessPayload } from '@nexova/shared'; // 2. Internal (@nexova/*)
import { LedgerService } from '@nexova/core';

import { formatDate } from './utils.js';              // 3. Relative (mismo módulo)

// ✅ CORRECTO - Type imports explícitos
import { type MessageSendPayload } from '@nexova/shared';

// ❌ INCORRECTO - Import relativo cross-package
import { AgentWorker } from '../../../packages/agent-runtime/src/worker/agent-worker';

// ❌ INCORRECTO - Import de barrel inexistente
import { Order } from '@nexova/shared/dto';
```


### Index Exports (Barrel Files)

```typescript
// packages/shared/src/index.ts
// Re-export selectivo para public API

// Schemas (para validación)
export * from './schemas/index.js';

// Types
export * from './types/index.js';

// Constants
export * from './constants/index.js';

// DTOs, events y utils se agregan más adelante
// export * from './dto/index.js';
// export * from './events/index.js';
// export * from './utils/index.js';
```


---

## ASSUMPTIONS

1. **ASSUMPTION:** Se usa pnpm como package manager por su eficiencia en monorepos y strict mode por defecto.

2. **ASSUMPTION:** Turborepo para orquestación de builds por su caché inteligente y paralelización.

3. **ASSUMPTION:** eslint-plugin-boundaries para enforcement de dependencias entre módulos en tiempo de lint.

4. **ASSUMPTION:** tsyringe para DI en backend (ligero, decorators-based). El dashboard no usa DI.

5. **ASSUMPTION:** Prisma schema centralizado en `/prisma` porque es un solo DB. Los tipos generados se re-exportan desde `@nexova/core/database`.

6. **ASSUMPTION:** El dashboard solo importa de `@nexova/shared` para tipos - nunca lógica de backend. Las validaciones del frontend son duplicadas (Zod en shared, react-hook-form en dashboard).
