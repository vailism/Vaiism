export class RuntimeKernel {
    constructor() {
        this.services = new Map();
        this.isStarted = false;
    }

    register(name, serviceInstance) {
        if (this.services.has(name)) {
            console.warn(`[Kernel] Service ${name} is already registered. Overwriting.`);
        }
        this.services.set(name, serviceInstance);
        console.log(`[Kernel] Registered service: ${name}`);
    }

    get(name) {
        const service = this.services.get(name);
        if (!service) {
            throw new Error(`[Kernel] Requested service not found: ${name}`);
        }
        return service;
    }

    async boot() {
        if (this.isStarted) return;
        console.log("[Kernel] Starting collaborative media runtime boot sequence...");

        // Inject Kernel references to all services
        for (const [name, service] of this.services.entries()) {
            if (typeof service.injectKernel === 'function') {
                service.injectKernel(this);
            }
        }

        // Boot services in logical topological order
        const bootOrder = [
            "logger", 
            "metrics", 
            "eventBus", 
            "fsm",
            "recovery.failureIsolation",
            "socket", 
            "network.presence",
            "network.quality",
            "provider.health", 
            "sync.confidence",
            "sync.snapshots",
            "sync.drift",
            "sync.heartbeats",
            "sync", 
            "recovery.watchdog",
            "recovery.reconnect",
            "recovery", 
            "ui.toast",
            "ui.status",
            "ui.presence",
            "ui.overlay",
            "ui.hud"
        ];

        for (const name of bootOrder) {
            if (this.services.has(name)) {
                const service = this.services.get(name);
                if (typeof service.onStart === 'function') {
                    console.log(`[Kernel] Booting service: ${name}`);
                    await service.onStart();
                }
            }
        }

        this.isStarted = true;
        console.log("[Kernel] Collaborative media runtime successfully booted!");
        
        const eventBus = this.services.get("eventBus");
        if (eventBus) {
            eventBus.emit("KERNEL_BOOT_COMPLETE", { timestamp: Date.now() });
        }
    }

    async shutdown() {
        if (!this.isStarted) return;
        console.log("[Kernel] Shutting down media runtime...");

        // Teardown in reverse boot order
        const shutdownOrder = [
            "ui.hud",
            "ui.overlay",
            "ui.presence",
            "ui.status",
            "ui.toast",
            "recovery",
            "recovery.reconnect",
            "recovery.watchdog",
            "sync",
            "sync.heartbeats",
            "sync.drift",
            "sync.snapshots",
            "sync.confidence",
            "provider.health",
            "network.quality",
            "network.presence",
            "socket",
            "recovery.failureIsolation",
            "fsm",
            "eventBus",
            "metrics",
            "logger"
        ];

        for (const name of shutdownOrder) {
            if (this.services.has(name)) {
                const service = this.services.get(name);
                if (typeof service.onStop === 'function') {
                    try {
                        console.log(`[Kernel] Stopping service: ${name}`);
                        await service.onStop();
                    } catch (e) {
                        console.error(`[Kernel] Error stopping service ${name}:`, e);
                    }
                }
            }
        }

        this.isStarted = false;
        this.services.clear();
        console.log("[Kernel] Runtime terminated cleanly.");
    }
}
