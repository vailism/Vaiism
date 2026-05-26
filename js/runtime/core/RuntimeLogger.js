export class RuntimeLogger {
    constructor() {
        this.kernel = null;
        this.eventBus = null;
        this.logs = [];
        this.maxLogsCount = 100;
    }

    injectKernel(kernel) {
        this.kernel = kernel;
        this.eventBus = kernel.get("eventBus");
    }

    onStart() {
        if (this.eventBus) {
            // Watch all EventBus messages to record structured traces
            this.eventBus.on('*', (event, payload) => {
                this.log("info", event, payload);
            });
        }
    }

    onStop() {
        this.logs = [];
    }

    log(severity, event, payload = null) {
        const logEntry = {
            ts: Date.now(),
            subsystem: this._inferSubsystem(event),
            level: severity,
            event: event,
            payload: payload
        };
        
        this.logs.push(logEntry);
        if (this.logs.length > this.maxLogsCount) {
            this.logs.shift();
        }

        console.log(`[RuntimeLog][${logEntry.level.toUpperCase()}][${logEntry.subsystem}] ${event}`, payload || '');
    }

    exportTraces() {
        return JSON.stringify(this.logs, null, 2);
    }

    _inferSubsystem(event) {
        if (!event) return "unknown";
        const ev = event.toLowerCase();
        if (ev.includes("fsm") || ev.includes("kernel")) return "kernel";
        if (ev.includes("socket") || ev.includes("presence") || ev.includes("chat") || ev.includes("typing") || ev.includes("rtt")) return "network";
        if (ev.includes("sync") || ev.includes("heartbeat") || ev.includes("drift")) return "sync";
        if (ev.includes("provider") || ev.includes("adapter")) return "provider";
        if (ev.includes("recovery") || ev.includes("watchdog") || ev.includes("stall")) return "recovery";
        if (ev.includes("ui") || ev.includes("hud") || ev.includes("toast") || ev.includes("overlay")) return "ui";
        return "core";
    }
}
