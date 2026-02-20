import { describe, expect, it } from 'vitest';

import { extractSelectionIndex, parseGlobalFlowIntent } from '../../src/core/intent-router.js';

describe('intent-router', () => {
  describe('extractSelectionIndex', () => {
    it('parses direct numeric replies', () => {
      expect(extractSelectionIndex('1')).toBe(1);
      expect(extractSelectionIndex('#3')).toBe(3);
      expect(extractSelectionIndex('2.')).toBe(2);
    });

    it('parses direct spanish word replies', () => {
      expect(extractSelectionIndex('dos')).toBe(2);
      expect(extractSelectionIndex('opcion cinco')).toBe(5);
    });

    it('parses contextual numeric replies', () => {
      expect(extractSelectionIndex('el 5')).toBe(5);
      expect(extractSelectionIndex('opcion 2')).toBe(2);
      expect(extractSelectionIndex('pedido numero 7')).toBe(7);
      expect(extractSelectionIndex('la quinta')).toBe(5);
    });

    it('does not parse explicit order numbers as indexes', () => {
      expect(extractSelectionIndex('ORD-00005')).toBeNull();
      expect(extractSelectionIndex('ord 9')).toBeNull();
    });
  });

  describe('parseGlobalFlowIntent', () => {
    it('detects payment intent', () => {
      expect(parseGlobalFlowIntent('quiero pagar un pedido')).toBe('payment');
      expect(parseGlobalFlowIntent('te mando comprobante de pago')).toBe('payment');
    });

    it('detects order intent', () => {
      expect(parseGlobalFlowIntent('quiero hacer un pedido nuevo')).toBe('order');
      expect(parseGlobalFlowIntent('quiero pedir de nuevo')).toBe('order');
    });

    it('detects active orders and catalog intent', () => {
      expect(parseGlobalFlowIntent('ver mis pedidos pendientes')).toBe('active_orders');
      expect(parseGlobalFlowIntent('mandame el catalogo')).toBe('catalog');
    });

    it('detects menu intent', () => {
      expect(parseGlobalFlowIntent('volver al menu')).toBe('menu');
      expect(parseGlobalFlowIntent('inicio')).toBe('menu');
    });

    it('returns null for ambiguous short input', () => {
      expect(parseGlobalFlowIntent('el 5')).toBeNull();
    });
  });
});
