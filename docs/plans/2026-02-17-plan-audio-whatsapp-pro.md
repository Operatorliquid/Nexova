# Plan: Transcripcion de Audio para WhatsApp (solo Pro)

## Objetivo
Agregar soporte de mensajes de audio en WhatsApp para convertirlos a texto y procesarlos dentro del agente, con control por plan, limites mensuales y trazabilidad completa.

## Decisiones tecnicas
- La transcripcion sera centralizada en backend (agnostica de proveedor), no dependiente de un proveedor WhatsApp.
- Se usara OpenAI Speech-to-Text como motor inicial (configurable por variables de entorno).
- La feature quedara habilitada solo para plan Pro con limite mensual configurable desde Admin.
- El procesamiento sera asincrono por cola para no bloquear webhook ni worker principal.

## PR1 - Feature flag y limites por plan
Entregable: capability `whatsappAudioTranscription` con gating en runtime y API.
Archivos principales:
- `/Users/josestratta/Documents/Nexova/packages/shared/src/constants/commerce-plan.ts`
- `/Users/josestratta/Documents/Nexova/packages/shared/src/constants/commerce-plan-limits.ts`
- `/Users/josestratta/Documents/Nexova/apps/api/src/utils/commerce-plan-limits.ts`
- `/Users/josestratta/Documents/Nexova/packages/agent-runtime/src/utils/commerce-plan-limits.ts`
- `/Users/josestratta/Documents/Nexova/apps/api/src/utils/monthly-usage.ts`
- `/Users/josestratta/Documents/Nexova/packages/agent-runtime/src/utils/monthly-usage.ts`
- `/Users/josestratta/Documents/Nexova/apps/api/src/routes/v1/admin.routes.ts`
- `/Users/josestratta/Documents/Nexova/apps/dashboard/src/pages/admin/AdminSettingsPage.tsx`
Criterio de aceptacion: Basic/Standard bloqueado, Pro habilitado, limite configurable y persistido.

## PR2 - Modelo de datos y cola de transcripcion
Entregable: entidad de trazabilidad de transcripciones + cola dedicada.
Archivos principales:
- `/Users/josestratta/Documents/Nexova/prisma/schema.prisma`
- `/Users/josestratta/Documents/Nexova/prisma/migrations/*`
- `/Users/josestratta/Documents/Nexova/packages/shared/src/constants/queues.ts`
- `/Users/josestratta/Documents/Nexova/packages/shared/src/types/queue-payloads.ts`
Criterio de aceptacion: se crea registro por audio, estado de proceso y metadatos basicos (workspace, proveedor, messageId, estado, transcript, error).

## PR3 - Ingesta de audio desde webhook (Infobip y Evolution)
Entregable: deteccion de audio inbound + encolado de transcripcion.
Archivos principales:
- `/Users/josestratta/Documents/Nexova/apps/api/src/routes/v1/webhook.routes.ts`
- `/Users/josestratta/Documents/Nexova/packages/integrations/src/whatsapp/infobip.client.ts`
- `/Users/josestratta/Documents/Nexova/packages/integrations/src/whatsapp/evolution.client.ts`
Criterio de aceptacion: audio entrante genera job de transcripcion y no rompe flujos existentes de texto, imagen, pdf, sticker.

## PR4 - Worker de transcripcion y proveedor STT
Entregable: worker dedicado que descarga media, normaliza formato y transcribe.
Archivos principales:
- `/Users/josestratta/Documents/Nexova/apps/worker/src/main.ts`
- `/Users/josestratta/Documents/Nexova/packages/integrations/src/*` (adapter STT)
- `/Users/josestratta/Documents/Nexova/packages/agent-runtime/src/worker/agent-worker.ts`
Criterio de aceptacion: audio valido termina en transcript utilizable por el agente, con manejo de errores y reintento controlado.

## PR5 - Endpoint API y Tool para transcripcion
Entregable: API operable y tool disponible para acciones manuales/retry.
Endpoints:
- `POST /api/v1/workspaces/:workspaceId/audio/transcriptions`
- `GET /api/v1/workspaces/:workspaceId/audio/transcriptions/:id`
- `POST /api/v1/workspaces/:workspaceId/audio/transcriptions/:id/retry`
Tooling:
- `transcribe_audio_message`
- `get_audio_transcript`
Archivos principales:
- `/Users/josestratta/Documents/Nexova/apps/api/src/routes/v1/*`
- `/Users/josestratta/Documents/Nexova/packages/agent-runtime/src/tools/retail/index.ts`
- `/Users/josestratta/Documents/Nexova/packages/agent-runtime/src/tools/retail/commerce.tools.ts`
Criterio de aceptacion: API y tools respetan gating Pro y limites mensuales.

## PR6 - Integracion funcional en agente WhatsApp
Entregable: el audio transcripto entra al mismo pipeline semantico que texto.
Archivos principales:
- `/Users/josestratta/Documents/Nexova/packages/agent-runtime/src/core/agent.ts`
- `/Users/josestratta/Documents/Nexova/packages/agent-runtime/src/worker/agent-worker.ts`
- `/Users/josestratta/Documents/Nexova/packages/agent-runtime/src/prompts/retail-system.ts`
Criterio de aceptacion: usuario envia audio y recibe respuesta coherente del agente sin desviar flujos existentes.

## PR7 - Observabilidad, QA y rollout
Entregable: cobertura de test + telemetria + rollback claro.
Archivos principales:
- tests API/worker/agent en paquetes afectados
- logs estructurados en webhook, queue y STT
- metricas de uso mensual en Admin
Criterio de aceptacion: casos cubiertos para Pro/no Pro, limite agotado, audio invalido, timeout STT, retry y dedupe.

## Reglas de negocio
- Solo Pro puede usar transcripcion de audio.
- Si no es Pro: respuesta clara de upgrade y no se consume cuota.
- Si supera limite mensual: respuesta clara de limite y no se procesa.
- Sticker nunca se trata como comprobante ni como audio a transcribir.

## Variables de entorno nuevas (propuestas)
- `AUDIO_TRANSCRIPTION_ENABLED=true`
- `AUDIO_TRANSCRIPTION_PROVIDER=openai`
- `OPENAI_API_KEY=...`
- `OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe`
- `AUDIO_TRANSCRIPTION_TIMEOUT_MS=30000`
- `AUDIO_TRANSCRIPTION_MAX_FILE_MB=25`

## Criterios finales de aceptacion del proyecto
- Audio inbound en Pro se transcribe y responde.
- Audio inbound en Basic/Standard se bloquea correctamente.
- Limite mensual configurable desde Admin y efectivamente aplicado.
- No hay regresion en texto/imagenes/pdf/stickers.
- API, worker y dashboard mantienen estabilidad en produccion.
