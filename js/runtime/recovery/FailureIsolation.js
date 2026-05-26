export class FailureIsolation {
    constructor() {
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
        // Teardown hook
    }

    runSafe(subsystem, actionName, fn, fallback = null) {
        try {
            return fn();
        } catch (e) {
            console.error(`[FailureIsolation][${subsystem}] Error during ${actionName}:`, e);
            if (this.eventBus) {
                this.eventBus.emit("SUB_SYSTEM_CRASHED", { subsystem, actionName, error: e.message });
            }
            if (fallback) {
                try {
                    return fallback(e);
                } catch (fallbackError) {
                    console.error("[FailureIsolation] Error in fallback function:", fallbackError);
                }
            }
            return null;
        }
    }
}
