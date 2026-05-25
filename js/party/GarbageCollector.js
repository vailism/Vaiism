/**
 * @file GarbageCollector.js
 * @description Manages automatic registration and removal of event listeners, intervals, and observers.
 */
export class GarbageCollector {
    constructor() {
        this.listeners = [];
        this.intervals = [];
        this.timeouts = [];
        this.observers = [];
    }

    /**
     * Registers a DOM event listener
     * @param {EventTarget} target Target element
     * @param {string} event Event type
     * @param {EventListenerOrEventListenerObject} callback Event callback
     * @param {boolean|AddEventListenerOptions} [options] Event options
     */
    addListener(target, event, callback, options = false) {
        target.addEventListener(event, callback, options);
        this.listeners.push({ target, event, callback, options });
    }

    /**
     * Registers an interval timer
     * @param {Function} callback Callback handler
     * @param {number} delay Delay in milliseconds
     * @returns {number} Interval ID
     */
    addInterval(callback, delay) {
        const id = setInterval(callback, delay);
        this.intervals.push(id);
        return id;
    }

    /**
     * Registers a timeout timer
     * @param {Function} callback Callback handler
     * @param {number} delay Delay in milliseconds
     * @returns {number} Timeout ID
     */
    addTimeout(callback, delay) {
        const id = setTimeout(callback, delay);
        this.timeouts.push(id);
        return id;
    }

    /**
     * Registers a MutationObserver or IntersectionObserver
     * @param {MutationObserver|IntersectionObserver} observer Instantiated observer
     * @param {Element} target Target DOM node to observe
     * @param {object} [config] Observation configurations
     */
    addObserver(observer, target, config = {}) {
        if (observer instanceof MutationObserver) {
            observer.observe(target, config);
        } else if (observer instanceof IntersectionObserver) {
            observer.observe(target);
        }
        this.observers.push(observer);
    }

    /**
     * Executes teardowns on all registered listeners and timers, releasing memory.
     */
    cleanup() {
        // Unbind listeners
        this.listeners.forEach(({ target, event, callback, options }) => {
            try {
                target.removeEventListener(event, callback, options);
            } catch (e) {
                console.warn("[GarbageCollector] Failed to unbind event listener:", e);
            }
        });
        this.listeners = [];

        // Clear intervals
        this.intervals.forEach(id => clearInterval(id));
        this.intervals = [];

        // Clear timeouts
        this.timeouts.forEach(id => clearTimeout(id));
        this.timeouts = [];

        // Disconnect observers
        this.observers.forEach(observer => {
            try {
                observer.disconnect();
            } catch (e) {
                console.warn("[GarbageCollector] Failed to disconnect observer:", e);
            }
        });
        this.observers = [];
    }
}
