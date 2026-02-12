# Evaluaciones de agente (suite mínima)

Formato de caso (JSON):
```json
{
  "id": "basic-order",
  "description": "Pedido simple",
  "messages": [
    { "role": "user", "content": "quiero 2 cocas" }
  ],
  "expect": {
    "mode": "order",
    "mustMention": ["pedido", "coca"],
    "mustNotMention": ["stock"]
  }
}
```

Notas:
- Estos casos son ejemplos para validar routing, consistencia y seguridad.
- La ejecución de LLM requiere API keys y puede variar; usar como referencia de regresión.
