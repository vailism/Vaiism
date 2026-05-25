/**
 * @file config.js
 * @description Watch Together global configuration constants and tuning parameters.
 */
export const PARTY_CONFIG = {
    APP_ID: "vpaas-magic-cookie-1e406aef47f544af904cb97ff3730091",
    DOMAIN: "8x8.vc",
    VERSION: "1.0.0",
    SYNC: {
        DRIFT_THRESHOLD_SECONDS: 1.5,
        HEARTBEAT_INTERVAL_MS: 3000,
        LOCAL_LOCK_TIMEOUT_MS: 400,
        PID: {
            KP: 0.08,
            KI: 0.01,
            KD: 0.02
        }
    },
    RECONNECT: {
        BASE_DELAY_MS: 1000,
        MAX_ATTEMPTS: 5
    },
    SECURITY: {
        LEASE_DURATION_MS: 5000,
        LEASE_HEARTBEAT_MS: 2000
    }
};
