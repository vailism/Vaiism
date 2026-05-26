export class MetricsStore {
    constructor() {
        this.kernel = null;
        this.eventBus = null;
        this.metrics = {
            driftHistory: [],
            hardSeeksCount: 0,
            reconnectCount: 0,
            providerReloads: 0,
            stallsCount: 0,
            rttHistory: [],
            heartbeatMisses: 0,
            recoveryAttempts: 0
        };
    }

    injectKernel(kernel) {
        this.kernel = kernel;
        this.eventBus = kernel.get("eventBus");
    }

    onStart() {
        if (this.eventBus) {
            this.eventBus.on("RTT_MEASURED", (rtt) => this.recordRtt(rtt));
            this.eventBus.on("DRIFT_CORRECTED", (drift) => this.recordDrift(drift));
        }
    }

    onStop() {
        this.reset();
    }

    reset() {
        this.metrics = {
            driftHistory: [],
            hardSeeksCount: 0,
            reconnectCount: 0,
            providerReloads: 0,
            stallsCount: 0,
            rttHistory: [],
            heartbeatMisses: 0,
            recoveryAttempts: 0
        };
    }

    increment(key) {
        if (this.metrics[key] !== undefined) {
            this.metrics[key]++;
            this.emitUpdate();
        }
    }

    recordRtt(rtt) {
        this.metrics.rttHistory.push(rtt);
        if (this.metrics.rttHistory.length > 50) {
            this.metrics.rttHistory.shift();
        }
        this.emitUpdate();
    }

    recordDrift(drift) {
        this.metrics.driftHistory.push(drift);
        if (this.metrics.driftHistory.length > 50) {
            this.metrics.driftHistory.shift();
        }
        this.emitUpdate();
    }

    getAverageRtt(currentRtt = 0) {
        const history = this.metrics.rttHistory;
        if (history.length === 0) return currentRtt;
        const sum = history.reduce((a, b) => a + b, 0);
        return Math.round(sum / history.length);
    }

    getAverageDrift() {
        const history = this.metrics.driftHistory;
        if (history.length === 0) return 0;
        const sum = history.reduce((a, b) => a + Math.abs(b), 0);
        return sum / history.length;
    }

    emitUpdate() {
        if (this.eventBus) {
            this.eventBus.emit("METRICS_UPDATED", this.metrics);
        }
    }
}
