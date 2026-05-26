export class PlaybackStateMachine {
    constructor() {
        this.currentState = "IDLE";
        this.allowedTransitions = {
            "IDLE": ["CONNECTING"],
            "CONNECTING": ["JOINING", "DISCONNECTED", "FAILED", "IDLE"],
            "JOINING": ["BUFFERING", "READY", "DISCONNECTED", "FAILED", "IDLE"],
            "BUFFERING": ["READY", "STALLED", "PLAYING", "PAUSED", "DISCONNECTED", "FAILED", "IDLE"],
            "READY": ["PLAYING", "PAUSED", "SYNCING", "BUFFERING", "STALLED", "DISCONNECTED", "FAILED", "IDLE"],
            "PLAYING": ["PAUSED", "SYNCING", "BUFFERING", "STALLED", "DISCONNECTED", "FAILED", "IDLE"],
            "PAUSED": ["PLAYING", "SYNCING", "BUFFERING", "STALLED", "DISCONNECTED", "FAILED", "IDLE"],
            "SYNCING": ["PLAYING", "PAUSED", "BUFFERING", "STALLED", "DISCONNECTED", "FAILED", "IDLE"],
            "STALLED": ["RECOVERING", "PLAYING", "PAUSED", "DISCONNECTED", "FAILED", "IDLE"],
            "RECOVERING": ["PLAYING", "PAUSED", "READY", "STALLED", "DISCONNECTED", "FAILED", "IDLE"],
            "DISCONNECTED": ["CONNECTING", "IDLE"],
            "FAILED": ["CONNECTING", "IDLE"]
        };
        this.onTransitionCallbacks = [];
        this.kernel = null;
        this.eventBus = null;
    }

    injectKernel(kernel) {
        this.kernel = kernel;
        this.eventBus = kernel.get("eventBus");
    }

    onStart() {
        // Initialization hook
    }

    onStop() {
        this.currentState = "IDLE";
        this.onTransitionCallbacks = [];
    }

    transitionTo(newState, reason = "") {
        if (this.currentState === newState) return true;
        const allowed = this.allowedTransitions[this.currentState];
        if (!allowed || !allowed.includes(newState)) {
            console.warn(`[FSM] Invalid state transition: ${this.currentState} -> ${newState} (${reason})`);
            return false;
        }
        const oldState = this.currentState;
        this.currentState = newState;
        console.log(`[FSM] State: ${oldState} -> ${newState} | Reason: ${reason}`);

        if (this.eventBus) {
            this.eventBus.emit("FSM_TRANSITION", {
                currentState: newState,
                oldState: oldState,
                reason: reason,
                timestamp: Date.now()
            });
        }

        this.onTransitionCallbacks.forEach(cb => {
            try {
                cb(newState, oldState, reason);
            } catch (e) {
                console.error("[FSM] Error in transition callback:", e);
            }
        });
        return true;
    }

    onTransition(cb) {
        this.onTransitionCallbacks.push(cb);
    }
}
