/**
 * @file OfflineQueue.js
 * @description Collects user events during offline connectivity states and replays them on reconnect.
 */
export class OfflineQueue {
    constructor() {
        this.queue = [];
    }

    /**
     * Queues an event, ensuring duplicate/outdated actions are pruned.
     * @param {string} namespace Message namespace
     * @param {string} event Event type
     * @param {object} payload Command parameters
     */
    enqueue(namespace, event, payload) {
        // Discard older seeks to prevent seek loops on reconnect
        if (event === "SEEK") {
            this.queue = this.queue.filter(item => item.event !== "SEEK");
        }
        this.queue.push({ namespace, event, payload, ts: Date.now() });
    }

    /**
     * Replays queued actions to the room signaling plane.
     * @param {RoomManager} roomManager Room coordinator instance
     */
    flush(roomManager) {
        if (!roomManager || this.queue.length === 0) return;
        
        console.log(`[OfflineQueue] Flushing ${this.queue.length} queued action(s)...`);
        while (this.queue.length > 0) {
            const action = this.queue.shift();
            roomManager.broadcastCommand(action.namespace, action.event, action.payload);
        }
    }

    clear() {
        this.queue = [];
    }
}
