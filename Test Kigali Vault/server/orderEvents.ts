import { EventEmitter } from 'node:events';

export interface OrderUpdateEvent {
  order_reference: string;
  event: 'created' | 'status_changed' | 'customer_received';
  timestamp: string;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

export function emitOrderUpdate(
  order_reference: string,
  event: OrderUpdateEvent['event']
): void {
  emitter.emit('order_update', {
    order_reference,
    event,
    timestamp: new Date().toISOString(),
  } satisfies OrderUpdateEvent);
}

export function subscribeOrderUpdates(
  listener: (payload: OrderUpdateEvent) => void
): () => void {
  emitter.on('order_update', listener);
  return () => {
    emitter.off('order_update', listener);
  };
}
