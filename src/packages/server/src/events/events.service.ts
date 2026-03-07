import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

@Injectable()
export class EventsService {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  on(event: string, handler: (...args: unknown[]) => void) {
    this.emitter.on(event, handler);
  }

  off(event: string, handler: (...args: unknown[]) => void) {
    this.emitter.off(event, handler);
  }

  emit(event: string, ...args: unknown[]) {
    this.emitter.emit(event, ...args);
  }

  once(event: string, handler: (...args: unknown[]) => void) {
    this.emitter.once(event, handler);
  }
}
