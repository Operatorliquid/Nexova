/**
 * Queue Service
 * Manages BullMQ queues for message processing
 */
import { Queue, QueueOptions } from 'bullmq';
import { QUEUES } from '@nexova/shared';

export interface QueueConnection {
  host: string;
  port: number;
  password?: string;
}

class QueueServiceClass {
  private queues: Map<string, Queue> = new Map();
  private connection: QueueConnection | null = null;

  /**
   * Initialize queue service with Redis connection
   */
  initialize(connection: QueueConnection): void {
    this.connection = connection;
  }

  /**
   * Get or create a queue
   */
  getQueue(queueName: string): Queue {
    if (!this.connection) {
      throw new Error('Queue service not initialized. Call initialize() first.');
    }

    let queue = this.queues.get(queueName);
    if (!queue) {
      const options: QueueOptions = {
        connection: this.connection,
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 1000,
        },
      };
      queue = new Queue(queueName, options);
      this.queues.set(queueName, queue);
    }
    return queue;
  }

  /**
   * Get the agent processing queue
   */
  getAgentQueue(): Queue {
    return this.getQueue(QUEUES.AGENT_PROCESS.name);
  }

  /**
   * Get the message sending queue
   */
  getMessageQueue(): Queue {
    return this.getQueue(QUEUES.MESSAGE_SEND.name);
  }

  /**
   * Close all queues
   */
  async closeAll(): Promise<void> {
    for (const queue of this.queues.values()) {
      await queue.close();
    }
    this.queues.clear();
  }
}

export const QueueService = new QueueServiceClass();
