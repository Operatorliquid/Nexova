# NEXOVA RBAC Endpoint Matrix

Fecha: 2026-02-18

## Objetivo
Definir de forma explícita el permiso requerido por endpoint crítico multiusuario para evitar regresiones de autorización.

## Workspace
| Método | Endpoint | Permiso |
| --- | --- | --- |
| `GET` | `/api/v1/workspaces/:id` | `settings:read` |
| `PATCH` | `/api/v1/workspaces/:id` | `settings:update` |
| `GET` | `/api/v1/workspaces/:id/roles` | `members:read` |
| `POST` | `/api/v1/workspaces/:id/members/invite` | `members:create` |
| `DELETE` | `/api/v1/workspaces/:id/members/:memberId` | `members:delete` |
| `PATCH` | `/api/v1/workspaces/:id/settings` | `settings:update` (+ `payments:update` para facturación/medios de pago, + `sessions:takeover` para owner agent) |
| `GET` | `/api/v1/workspaces/:id/whatsapp-numbers` | `connections:read` |
| `POST` | `/api/v1/workspaces/:id/whatsapp-numbers/:numberId/claim` | `connections:create` |
| `POST` | `/api/v1/workspaces/:id/whatsapp-numbers/release` | `connections:delete` |

## Conversations / Inbox
| Método | Endpoint | Permiso |
| --- | --- | --- |
| `GET` | `/api/v1/conversations` | `sessions:read` |
| `GET` | `/api/v1/conversations/:sessionId/messages` | `sessions:read` |
| `POST` | `/api/v1/conversations/:sessionId/messages` | `sessions:message` |
| `PATCH` | `/api/v1/conversations/:sessionId/agent` | `sessions:takeover` |
| `DELETE` | `/api/v1/conversations/:sessionId` | `sessions:release` |

## Orders
| Método | Endpoint | Permiso |
| --- | --- | --- |
| `GET` | `/api/v1/orders` | `orders:read` |
| `POST` | `/api/v1/orders` | `orders:create` |
| `PATCH` | `/api/v1/orders/:id` | `orders:update` |
| `POST` | `/api/v1/orders/:id/restore` | `orders:update` |
| `DELETE` | `/api/v1/orders/:id` | `orders:cancel` |
| `DELETE` | `/api/v1/orders/trash` | `orders:cancel` |
| `POST` | `/api/v1/orders/:id/receipts` | `payments:create` |

## Customers
| Método | Endpoint | Permiso |
| --- | --- | --- |
| `GET` | `/api/v1/customers` | `customers:read` |
| `POST` | `/api/v1/customers` | `customers:create` |
| `PATCH` | `/api/v1/customers/:id` | `customers:update` |
| `DELETE` | `/api/v1/customers/:id` | `customers:delete` |
| `GET` | `/api/v1/customers/:id/notes` | `customers:read` |
| `POST` | `/api/v1/customers/:id/notes` | `customers:update` |
| `DELETE` | `/api/v1/customers/:id/notes/:noteId` | `customers:update` |
| `POST` | `/api/v1/customers/debt-reminders/bulk` | `payments:update` |

## Integrations / Payments
| Método | Endpoint | Permiso |
| --- | --- | --- |
| `GET` | `/api/v1/integrations/mercadopago/auth-url` | `connections:create` |
| `GET` | `/api/v1/integrations/mercadopago/status` | `connections:read` |
| `DELETE` | `/api/v1/integrations/mercadopago` | `connections:delete` |
| `POST` | `/api/v1/integrations/arca/invoices` | `payments:create` |
| `POST` | `/api/v1/integrations/payments/create-link` | `payments:create` |
| `GET` | `/api/v1/integrations/receipts` | `payments:read` |
| `GET` | `/api/v1/integrations/receipts/:id/file` | `payments:read` |
| `POST` | `/api/v1/integrations/receipts/:id/apply` | `payments:update` |
| `DELETE` | `/api/v1/integrations/receipts/:id` | `payments:update` |
| `GET` | `/api/v1/integrations/customers/:id/balance` | `payments:read` |
| `GET` | `/api/v1/integrations/customers/:id/ledger` | `payments:read` |

## Products / Stock / Analytics
| Método | Endpoint | Permiso |
| --- | --- | --- |
| `GET` | `/api/v1/products` | `products:read` |
| `POST` | `/api/v1/products` | `products:create` |
| `PATCH` | `/api/v1/products/:id` | `products:update` |
| `DELETE` | `/api/v1/products/:id` | `products:delete` |
| `POST` | `/api/v1/stock-receipts/preview` | `stock:adjust` |
| `POST` | `/api/v1/stock-receipts/:id/apply` | `stock:adjust` |
| `GET` | `/api/v1/analytics/metrics` | `analytics:read` |
| `GET` | `/api/v1/analytics/insights` | `analytics:read` |

## Uploads
| Método | Endpoint | Permiso |
| --- | --- | --- |
| `GET` | `/api/v1/uploads/file/:category/:filename` | Según categoría (`products:read`, `orders:read`, `payments:read`, `stock:read`) o firma válida |
| `POST` | `/api/v1/uploads/product-image` | `products:create` o `products:update` |
