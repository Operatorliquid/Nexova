/**
 * Agent State Machine (FSM)
 * Manages conversation flow states and transitions
 */
import { AgentState, AgentStateType } from '../types/index.js';

interface Transition {
  from: AgentStateType | AgentStateType[];
  to: AgentStateType;
  condition?: string;
}

// Valid state transitions
const TRANSITIONS: Transition[] = [
  // From IDLE
  { from: AgentState.IDLE, to: AgentState.COLLECTING_ORDER },
  { from: AgentState.IDLE, to: AgentState.HANDOFF },

  // From COLLECTING_ORDER
  { from: AgentState.COLLECTING_ORDER, to: AgentState.NEEDS_DETAILS },
  { from: AgentState.COLLECTING_ORDER, to: AgentState.AWAITING_CONFIRMATION },
  { from: AgentState.COLLECTING_ORDER, to: AgentState.IDLE },
  { from: AgentState.COLLECTING_ORDER, to: AgentState.HANDOFF },

  // From NEEDS_DETAILS
  { from: AgentState.NEEDS_DETAILS, to: AgentState.COLLECTING_ORDER },
  { from: AgentState.NEEDS_DETAILS, to: AgentState.AWAITING_CONFIRMATION },
  { from: AgentState.NEEDS_DETAILS, to: AgentState.IDLE },
  { from: AgentState.NEEDS_DETAILS, to: AgentState.HANDOFF },

  // From AWAITING_CONFIRMATION
  { from: AgentState.AWAITING_CONFIRMATION, to: AgentState.EXECUTING },
  { from: AgentState.AWAITING_CONFIRMATION, to: AgentState.COLLECTING_ORDER },
  { from: AgentState.AWAITING_CONFIRMATION, to: AgentState.IDLE },
  { from: AgentState.AWAITING_CONFIRMATION, to: AgentState.HANDOFF },

  // From EXECUTING
  { from: AgentState.EXECUTING, to: AgentState.DONE },
  { from: AgentState.EXECUTING, to: AgentState.HANDOFF },
  { from: AgentState.EXECUTING, to: AgentState.IDLE }, // On error, retry

  // From DONE
  { from: AgentState.DONE, to: AgentState.IDLE },
  { from: AgentState.DONE, to: AgentState.COLLECTING_ORDER },

  // From HANDOFF - only human can release
  { from: AgentState.HANDOFF, to: AgentState.IDLE },
];

export class StateMachine {
  private currentState: AgentStateType;
  private history: Array<{ from: AgentStateType; to: AgentStateType; timestamp: Date }> = [];

  constructor(initialState: AgentStateType = AgentState.IDLE) {
    this.currentState = initialState;
  }

  /**
   * Get current state
   */
  getState(): AgentStateType {
    return this.currentState;
  }

  /**
   * Check if transition is valid
   */
  canTransition(to: AgentStateType): boolean {
    return TRANSITIONS.some((t) => {
      const fromStates = Array.isArray(t.from) ? t.from : [t.from];
      return fromStates.includes(this.currentState) && t.to === to;
    });
  }

  /**
   * Transition to new state
   */
  transition(to: AgentStateType): boolean {
    if (!this.canTransition(to)) {
      console.warn(
        `[FSM] Invalid transition: ${this.currentState} -> ${to}`
      );
      return false;
    }

    const from = this.currentState;
    this.currentState = to;
    this.history.push({ from, to, timestamp: new Date() });

    console.log(`[FSM] Transition: ${from} -> ${to}`);
    return true;
  }

  /**
   * Force state (use with caution - for recovery scenarios)
   */
  forceState(state: AgentStateType): void {
    console.warn(`[FSM] Force state: ${this.currentState} -> ${state}`);
    this.history.push({
      from: this.currentState,
      to: state,
      timestamp: new Date(),
    });
    this.currentState = state;
  }

  /**
   * Get transition history
   */
  getHistory(): Array<{ from: AgentStateType; to: AgentStateType; timestamp: Date }> {
    return [...this.history];
  }

  /**
   * Check if in collecting order flow
   */
  isInOrderFlow(): boolean {
    const orderFlowStates: AgentStateType[] = [
      AgentState.COLLECTING_ORDER,
      AgentState.NEEDS_DETAILS,
      AgentState.AWAITING_CONFIRMATION,
      AgentState.EXECUTING,
    ];
    return orderFlowStates.includes(this.currentState);
  }

  /**
   * Check if agent is active (not handed off)
   */
  isAgentActive(): boolean {
    return this.currentState !== AgentState.HANDOFF;
  }

  /**
   * Get valid transitions from current state
   */
  getValidTransitions(): AgentStateType[] {
    return TRANSITIONS.filter((t) => {
      const fromStates = Array.isArray(t.from) ? t.from : [t.from];
      return fromStates.includes(this.currentState);
    }).map((t) => t.to);
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    this.currentState = AgentState.IDLE;
    this.history = [];
  }
}

/**
 * Determine suggested state based on context
 */
export function suggestStateTransition(
  currentState: AgentStateType,
  context: {
    hasCart: boolean;
    cartItemCount: number;
    needsCustomerInfo: boolean;
    pendingConfirmation: boolean;
    orderConfirmed: boolean;
    handoffRequested: boolean;
  }
): AgentStateType | null {
  // Handoff takes priority
  if (context.handoffRequested) {
    return AgentState.HANDOFF;
  }

  // Order confirmed -> executing
  if (context.orderConfirmed && currentState === AgentState.AWAITING_CONFIRMATION) {
    return AgentState.EXECUTING;
  }

  // Pending confirmation
  if (context.pendingConfirmation && context.hasCart && context.cartItemCount > 0) {
    return AgentState.AWAITING_CONFIRMATION;
  }

  // Needs customer registration
  if (context.needsCustomerInfo) {
    return AgentState.NEEDS_DETAILS;
  }

  // Has items in cart -> collecting order
  if (context.hasCart && context.cartItemCount > 0) {
    return AgentState.COLLECTING_ORDER;
  }

  // Default: stay in current or go idle
  return null;
}
