/**
 * @file EventBus.js
 * @description A lightweight, type-safe PubSub Event Bus supporting decoupled communications.
 */
export class EventBus {
    constructor() {
        this.listeners = new Map();
    }

    /**
     * Subscribe to an event
     * @param {string} event Name of the event
     * @param {Function} callback Handler callback
     * @returns {Function} Unsubscribe function
     */
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);

        // Return a teardown closure for clean garbage collection
        return () => this.off(event, callback);
    }

    /**
     * Unsubscribe from an event
     * @param {string} event Name of the event
     * @param {Function} callback Handler callback
     */
    off(event, callback) {
        const eventSet = this.listeners.get(event);
        if (eventSet) {
            eventSet.delete(callback);
            if (eventSet.size === 0) {
                this.listeners.delete(event);
            }
        }
    }

    /**
     * Publish an event to all subscribers
     * @param {string} event Name of the event
     * @param {any} data Payload data
     */
    emit(event, data) {
        const eventSet = this.listeners.get(event);
        if (eventSet) {
            eventSet.forEach((callback) => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`[EventBus] Error in listener for event "${event}":`, error);
                }
            });
        }
    }

    /**
     * Clears all listeners to prevent leaks during teardowns
     */
    clear() {
        this.listeners.clear();
    }
}
