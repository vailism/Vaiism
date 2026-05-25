/**
 * @file TelemetryAgent.js
 * @description Collects, samples, and flushes connection and performance diagnostics to the telemetry server.
 */
import { PARTY_CONFIG } from './config.js';

export class TelemetryAgent {
    /**
     * @param {string} reportingUrl Endpoint to flush analytics beacons to
     * @param {RoomManager} roomManager Room coordinator instance
     */
    constructor(reportingUrl, roomManager) {
        this.endpoint = reportingUrl;
        this.room = roomManager;
        this.sampleRate = 0.10; // Sample 10% of users to avoid dashboard flooding
        this.isSampled = Math.random() < this.sampleRate;
        
        this.gc = roomManager.gc;

        if (this.isSampled && this.endpoint) {
            this._startReporting();
        }
    }

    _startReporting() {
        // Collect metrics periodically every 30 seconds
        this.gc.addInterval(() => {
            this.getPlayerStats().then(stats => {
                this.report("perf_metrics", stats);
            });
        }, 30000);
    }

    async getPlayerStats() {
        const memory = window.performance?.memory;
        return {
            rttMs: this.room.api?._lastRTT || 0,
            participantsCount: this.room.participants.size,
            reconnectAttempts: this.room.reconnectAttempts,
            heapUsedBytes: memory ? memory.usedJSHeapSize : 0,
            effectiveType: navigator.connection?.effectiveType || "unknown"
        };
    }

    /**
     * Sends analytics payload using navigator.sendBeacon (non-blocking teardown-safe)
     * @param {string} metricName Category identifier
     * @param {object} data Measurement body
     */
    report(metricName, data) {
        if (!this.isSampled || !this.endpoint) return;

        const payload = {
            v: PARTY_CONFIG.VERSION,
            metric: metricName,
            roomId: this.room.roomId,
            sessionId: this.room.localSessionId,
            username: this.room.username,
            data,
            ts: Date.now()
        };

        const json = JSON.stringify(payload);
        if (navigator.sendBeacon) {
            navigator.sendBeacon(this.endpoint, json);
        } else {
            fetch(this.endpoint, { method: "POST", body: json, keepalive: true }).catch(() => {});
        }
    }
}
