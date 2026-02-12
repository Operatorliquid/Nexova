/**
 * Tests for Conversation Router
 * Verifies ORDER/INFO classification and context switching
 */
import { describe, it, expect } from 'vitest';
import {
  ConversationRouter,
  classifyMessage,
} from '../../src/core/conversation-router.js';
import { AgentState, MessageThread } from '../../src/types/index.js';

describe('ConversationRouter', () => {
  const router = new ConversationRouter();

  describe('classifyMessage', () => {
    describe('ORDER thread detection', () => {
      it('should classify direct order requests as ORDER', () => {
        const result = classifyMessage(
          'quiero 5 cocas y 3 fantas',
          AgentState.IDLE,
          MessageThread.ORDER
        );

        expect(result.thread).toBe(MessageThread.ORDER);
        expect(result.confidence).toBeGreaterThan(0.5);
      });

      it('should classify quantity-based messages as ORDER', () => {
        const result = classifyMessage(
          'dame 10 cajas de agua mineral',
          AgentState.IDLE,
          MessageThread.ORDER
        );

        expect(result.thread).toBe(MessageThread.ORDER);
        expect(result.keywords).toContain('dame');
      });

      it('should classify cart modifications as ORDER', () => {
        const result = classifyMessage(
          'sacame una coca del carrito',
          AgentState.COLLECTING_ORDER,
          MessageThread.ORDER
        );

        expect(result.thread).toBe(MessageThread.ORDER);
      });

      it('should classify confirmations during order flow as ORDER', () => {
        const result = classifyMessage(
          'sí, confirmo',
          AgentState.AWAITING_CONFIRMATION,
          MessageThread.ORDER
        );

        expect(result.thread).toBe(MessageThread.ORDER);
        expect(result.confidence).toBeGreaterThan(0.7);
      });

      it('should classify "lo de siempre" as ORDER', () => {
        const result = classifyMessage(
          'mandame lo de siempre',
          AgentState.IDLE,
          MessageThread.ORDER
        );

        expect(result.thread).toBe(MessageThread.ORDER);
      });
    });

    describe('INFO thread detection', () => {
      it('should classify location questions as INFO', () => {
        const result = classifyMessage(
          '¿dónde están ubicados?',
          AgentState.IDLE,
          MessageThread.ORDER
        );

        expect(result.thread).toBe(MessageThread.INFO);
        expect(result.keywords).toContain('dónde');
      });

      it('should classify schedule questions as INFO', () => {
        const result = classifyMessage(
          '¿a qué hora cierran?',
          AgentState.IDLE,
          MessageThread.ORDER
        );

        expect(result.thread).toBe(MessageThread.INFO);
      });

      it('should classify delivery questions as INFO', () => {
        const result = classifyMessage(
          '¿hacen envíos a zona norte?',
          AgentState.IDLE,
          MessageThread.ORDER
        );

        expect(result.thread).toBe(MessageThread.INFO);
      });

      it('should classify price queries as INFO', () => {
        const result = classifyMessage(
          '¿cuánto cuesta la coca de litro?',
          AgentState.IDLE,
          MessageThread.ORDER
        );

        expect(result.thread).toBe(MessageThread.INFO);
      });

      it('should classify catalog requests as INFO', () => {
        const result = classifyMessage(
          'me pasás el catálogo?',
          AgentState.IDLE,
          MessageThread.ORDER
        );

        expect(result.thread).toBe(MessageThread.INFO);
      });
    });

    describe('Context-aware classification', () => {
      it('should prefer ORDER during active order flow', () => {
        // Even with INFO keywords, should stay in ORDER if weak signal
        const result = classifyMessage(
          'dale, agregame eso',
          AgentState.COLLECTING_ORDER,
          MessageThread.ORDER
        );

        expect(result.thread).toBe(MessageThread.ORDER);
      });

      it('should allow INFO interruption with strong signal', () => {
        const result = classifyMessage(
          '¿qué horarios tienen? ¿dónde están?',
          AgentState.COLLECTING_ORDER,
          MessageThread.ORDER
        );

        expect(result.thread).toBe(MessageThread.INFO);
        expect(result.shouldInterrupt).toBe(true);
      });

      it('should stay in current thread with ambiguous messages', () => {
        // "hola" alone - stay in current
        const result = classifyMessage(
          'hola',
          AgentState.COLLECTING_ORDER,
          MessageThread.ORDER
        );

        expect(result.thread).toBe(MessageThread.ORDER);
      });
    });

    describe('HANDOFF detection', () => {
      it('should detect handoff request keywords', () => {
        const result = classifyMessage(
          'quiero hablar con una persona',
          AgentState.COLLECTING_ORDER,
          MessageThread.ORDER
        );

        expect(result.handoffRequested).toBe(true);
      });

      it('should detect frustration keywords', () => {
        const result = classifyMessage(
          'no me sirve, hay un problema, estoy mal',
          AgentState.COLLECTING_ORDER,
          MessageThread.ORDER
        );

        expect(result.sentimentNegative).toBe(true);
      });
    });
  });

  describe('shouldReturnToOrder', () => {
    it('should return true when ORDER was interrupted for INFO', () => {
      const result = router.shouldReturnToOrder(
        MessageThread.ORDER,
        AgentState.COLLECTING_ORDER,
        MessageThread.INFO
      );

      expect(result).toBe(true);
    });

    it('should return false when not interrupting ORDER', () => {
      const result = router.shouldReturnToOrder(
        MessageThread.INFO,
        AgentState.IDLE,
        MessageThread.INFO
      );

      expect(result).toBe(false);
    });

    it('should return false when ORDER was in IDLE state', () => {
      const result = router.shouldReturnToOrder(
        MessageThread.ORDER,
        AgentState.IDLE,
        MessageThread.INFO
      );

      expect(result).toBe(false);
    });
  });

  describe('buildReturnToOrderContext', () => {
    it('should build context message with cart items', () => {
      const cart = {
        items: [
          { name: 'Coca Cola 500ml', quantity: 5 },
          { name: 'Fanta 500ml', quantity: 3 },
        ],
      };

      const message = router.buildReturnToOrderContext(cart);

      expect(message).toContain('5x Coca Cola 500ml');
      expect(message).toContain('3x Fanta 500ml');
      expect(message).toContain('pedido');
    });

    it('should handle empty cart', () => {
      const message = router.buildReturnToOrderContext(null);

      expect(message).toContain('pedido');
    });

    it('should truncate long item lists', () => {
      const cart = {
        items: [
          { name: 'Item 1', quantity: 1 },
          { name: 'Item 2', quantity: 2 },
          { name: 'Item 3', quantity: 3 },
          { name: 'Item 4', quantity: 4 },
          { name: 'Item 5', quantity: 5 },
        ],
      };

      const message = router.buildReturnToOrderContext(cart);

      expect(message).toContain('y 2 más');
    });
  });
});
