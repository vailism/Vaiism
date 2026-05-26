export class EventBus {
    constructor() {
        this.listeners = new Map();
        this.wildcardListeners = [];
    }

    on(event, callback) {
        if (event === '*') {
            this.wildcardListeners.push(callback);
            return () => this.off('*', callback);
        }
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
        return () => this.off(event, callback);
    }

    off(event, callback) {
        if (event === '*') {
            this.wildcardListeners = this.wildcardListeners.filter(cb => cb !== callback);
            return;
        }
        if (!this.listeners.has(event)) return;
        const list = this.listeners.get(event).filter(cb => cb !== callback);
        if (list.length === 0) {
            this.listeners.delete(event);
        } else {
            this.listeners.set(event, list);
        }
    }

    emit(event, data = null) {
        // Dispatch to wildcard loggers
        this.wildcardListeners.forEach(cb => {
            try { cb(event, data); } catch (e) { console.error("[EventBus] Wildcard Error:", e); }
        });

        const list = this.listeners.get(event);
        if (!list) return;
        
        // Use a copy to prevent modification errors during iteration
        const targets = [...list];
        for (let i = 0; i < targets.length; i++) {
            try {
                targets[i](data);
            } catch (e) {
                console.error(`[EventBus] Error in listener for ${event}:`, e);
            }
        }
    }

    clear() {
        this.listeners.clear();
        this.wildcardListeners = [];
    }
}
