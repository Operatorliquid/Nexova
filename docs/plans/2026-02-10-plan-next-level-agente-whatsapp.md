# Plan para llevar el agente de WhatsApp al next level (10 feb 2026)

**Estado:** Propuesto (sin implementación)

## Objetivos
- Mejorar memoria del agente (contexto útil y persistente entre mensajes y sesiones).
- Responder correctamente a mensajes consecutivos (batch/orden/latencia controlada).
- Orquestación con “sub‑agentes” especializados y herramientas más confiables.
- Elevar calidad, consistencia y métricas para SaaS vendible.

## Diagnóstico actual (resumen)
- **Memoria corta**: Redis `agent:session:{id}` guarda estado/carro/contexto puntual. El historial LLM viene de `agent_messages` con límite configurable (default 20).
- **Memoria larga**: existe tabla `agent_memories` pero no se usa aún.
- **Mensajes consecutivos**: cada webhook genera un job y se procesa individualmente; no hay coalescing ni lock por sesión (riesgo de orden y respuestas fragmentadas).
- **Orquestación**: el runtime real usa `RetailAgent` (core/agent.ts). Existe `AgentOrchestrator` pero no está cableado en producción.

## Mapeo a patrones “tipo n8n” en nuestro repo
**Tools Agent (n8n)** → `RetailAgent` + `toolRegistry`  
**AI Agent Tool (sub‑agente como tool)** → nuevo “SubAgentTool” que llama otro agente especializado con su set de tools  
**Sub‑workflow** → jobs en BullMQ (`agent:process`, `message:send`, `webhook-retry`) + servicios aislados  
**Memory** → `agent_messages` + `agent_memories` + Redis session  
**Plan & Execute** → orquestador con etapas explícitas por tarea (pedido, pago, soporte)  
**Human‑in‑the‑loop** → `request_handoff` + confirmaciones de tools (ya existe)  

## Arquitectura propuesta (sin implementación)
1. **Session Aggregator**: agrupa mensajes por `sessionId` en ventana corta y emite un job único.
2. **Conversation Store**: asegura orden y persistencia de mensajes (DB) con dedupe estable.
3. **Memory Service**: genera resúmenes + hechos persistentes (usa `agent_memories`).
4. **Retrieval**: trae “summary + facts + preferencias” para cada turno.
5. **Orchestrator**: decide sub‑agente especializado y controla herramientas.

## Sub‑agentes propuestos (primeros 2–3)
- **OrderAgent**: solo pedido, carrito, confirmación, edición.
- **InfoAgent**: catálogo, horarios, ubicación, preguntas frecuentes.
- **PaymentsAgent**: cobros, recibos, pagos, links.
*(SupportAgent queda para fase siguiente: reclamos/errores/casos complejos)*  

## Roadmap propuesto

### Fase 0 — Base de confiabilidad
**Meta:** preparar terreno sin cambiar comportamiento funcional.
- Auditar flujos críticos y cerrar gaps ya detectados (hallazgos guardados en `docs/reviews/2026-02-10-hallazgos-code-review.md`).
- Añadir métricas mínimas de calidad: ratio de mensajes respondidos, latencia por turno, errores de tools, handoff rate.
- Crear “feature flags” para cambios de IA (ej. `AGENT_COALESCE_WINDOW_MS`, `AGENT_MEMORY_SUMMARY_ENABLED`).

**Entregables:** métricas base, flags de rollout, backlog priorizado.

---

### Fase 1 — Responder mensajes consecutivos
**Meta:** el agente pueda responder correctamente cuando el usuario manda 2+ mensajes seguidos.

**Propuesta técnica (sin implementar):**
- **Coalescing por ventana corta**: guardar en Redis y esperar `X ms` (1500–3000 ms) antes de procesar, uniendo mensajes del mismo `sessionId`.
- **Orden estricto por sesión**: `jobId = sessionId` o lock Redis `agent:lock:{sessionId}` + re‑enqueue con delay.
- **Respuesta múltiple**: si el cliente envía dos temas distintos, responder en dos párrafos separados.
- **Fallback**: si el coalescing falla o excede TTL, procesar mensaje individual.

**Entregables:** modo coalescing por flag + garantía de orden por sesión.

---

### Fase 2 — Memoria robusta
**Meta:** el agente recuerde contexto útil más allá del historial inmediato.

**Propuesta técnica:**
- **Memoria corta mejorada**: ajuste dinámico de historial por tokens + resumen de sesión cuando crece.
- **Memoria larga**: usar `agent_memories` con tipos `summary`, `fact`, `preference`, `entity`.
- **Extracción de hechos**: al cerrar turno, extraer facts/preferencias con un prompt corto.
- **Recuperación**: cargar `summary + top N facts/preferencias` y pasar al prompt como “Contexto recordado”.
- **Vencimiento**: `expiresAt` por tipo de memoria (ej. facts 180d, preferences 365d, summary 30d).

**Entregables:** summary por sesión + memoria persistente recuperable.

---

### Fase 3 — Sub‑agentes y orquestador
**Meta:** especialización como en n8n (mejor precisión y control).

**Propuesta técnica:**
- **Sub‑agentes**: `OrderAgent`, `InfoAgent`, `PaymentsAgent` con prompts y tools acotados.
- **Orquestador único**: consolidar en un solo entrypoint (evolucionar `RetailAgent` o unificar con `AgentOrchestrator`).
- **Router avanzado**: además de ORDER/INFO, detectar “pagos”, “posventa”, “reclamo”.
- **Políticas**: validaciones previas a tools + confirmaciones reforzadas.

**Entregables:** orquestador + 2 sub‑agentes iniciales con tools limitadas.

---

### Fase 4 — Calidad y evaluación continua
**Meta:** demostrar mejora real y evitar regresiones.

**Propuesta técnica:**
- **Suite de casos reales**: transcripts anonimizados con criterios de éxito.
- **Tests de regresión**: pedido, consulta, pago, cancelación, errores.
- **A/B testing**: prompts, router, modelos, memoria on/off.
- **Dash IA**: handoff rate, resolución sin humano, FRT, NPS por conversación.

**Entregables:** banco de pruebas + reportes periódicos.

---

### Fase 5 — Producto enterprise‑ready
**Meta:** control y escalabilidad para SaaS vendible.
- Per‑workspace: configuración de tono, memoria, tiempos de coalescing, reglas de negocio.
- Controles de compliance (retención de memoria, PII, auditoría).
- Observabilidad avanzada: trazas por `correlationId`, performance y costos por cliente.

## KPIs sugeridos (baseline + objetivos)
- Handoff rate: -20% en 60 días.
- Resolución sin humano: +25% en 60 días.
- Latencia p95 por turno: < 2.5s (sin tools) y < 6s (con tools).
- Ratio de respuestas correctas en suite: > 85% al mes 2.

## Mapeo técnico (dónde tocar)
- Coalescing y lock por sesión: `packages/agent-runtime/src/worker/agent-worker.ts`
- Memoria larga y retrieval: `packages/agent-runtime/src/core/memory-manager.ts` + nueva capa “MemoryService”
- Orquestación y sub‑agentes: `packages/agent-runtime/src/core/agent.ts` o unificación con `core/orchestrator.ts`
- Historial/summary: `agent_messages` + `agent_memories`

## Guardrails de rollout
- Flags por workspace y “shadow mode” (guardar memoria sin usarla en prompt).
- Backoff a modo anterior si aumenta handoff rate o errores.
- Log de decisiones del orquestador en `audit_log`.

## Decisiones pendientes
- Ventana de coalescing deseada (latencia tolerable vs. calidad de respuesta).
- Qué memorias guardar (solo sesión vs también cross‑sesión por cliente).
- Política de expiración de memoria (ej. 30, 90, 180 días).
- Modelo(s) LLM a usar y fallback (costo/latencia/calidad).

## Próximos pasos sugeridos
1. Confirmar prioridades (memoria vs coalescing vs sub‑agentes).
2. Definir objetivos de KPI (ej. reducción de handoff 20%, +25% resolución sin humano).
3. Acordar ventana de coalescing y política de memoria.
