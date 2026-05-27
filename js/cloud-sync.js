import { auth, db, doc, setDoc, getDocs, collection, writeBatch, serverTimestamp } from './firebase-config.js';

class CloudSyncManagerImpl {
    constructor() {
        this.uid = null;
        this.isOnline = navigator.onLine;
        this.syncQueue = [];
        
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.flushQueue();
            this.updateUI('Online. Sync active.');
        });
        
        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.updateUI('Offline. Changes will sync when reconnected.', true);
        });
    }

    updateUI(message, isWarning = false) {
        const statusLabel = document.getElementById('syncStatusLabel');
        if (statusLabel) {
            statusLabel.textContent = message;
            statusLabel.style.color = isWarning ? '#ffcc00' : 'rgba(255, 255, 255, 0.5)';
        }
    }

    showSyncSpinner(show) {
        const icon = document.querySelector('.sync-info-footer i');
        if (icon) {
            if (show) {
                icon.setAttribute('data-lucide', 'loader-2');
                icon.classList.add('vailism-spin');
            } else {
                icon.setAttribute('data-lucide', 'cloud');
                icon.classList.remove('vailism-spin');
            }
            if (window.lucide) lucide.createIcons();
        }
    }

    async bootstrapUser(uid) {
        this.uid = uid;
        console.log(`[VAILISM CLOUD] Bootstrapping user ${uid}`);
        this.showSyncSpinner(true);
        
        try {
            await this.loadWatchlist();
            await this.loadProgress();
            await this.mergeLocalData();
            
            this.updateUI('Cloud synchronization is active and fully functional.');
            
            // Notify other tabs
            try {
                const bc = new BroadcastChannel('vailism_sync');
                bc.postMessage({ type: 'UPDATE' });
                bc.close();
            } catch(e) {}
            
        } catch (error) {
            console.error('[VAILISM CLOUD] Bootstrap failed:', error);
            this.updateUI('Sync failed. Retrying...', true);
        } finally {
            this.showSyncSpinner(false);
        }
    }

    clearLocalState() {
        this.uid = null;
        this.updateUI('Not logged in. Log in to sync to the cloud.');
        // Optionally clear IndexedDB / LocalStorage here if guest mode is strictly separated
    }

    async loadWatchlist() {
        if (!this.uid) return;
        console.log('[VAILISM FIRESTORE] Loading watchlist...');
        const snapshot = await getDocs(collection(db, `users/${this.uid}/watchlist`));
        let items = [];
        snapshot.forEach(doc => {
            items.push(doc.data());
        });
        
        // Update local storage
        localStorage.setItem('vailism_watchlist', JSON.stringify({ items, updated: Date.now() }));
    }

    async loadProgress() {
        if (!this.uid) return;
        console.log('[VAILISM FIRESTORE] Loading watch progress...');
        const snapshot = await getDocs(collection(db, `users/${this.uid}/progress`));
        
        snapshot.forEach(doc => {
            const data = doc.data();
            localStorage.setItem(`vailism_progress_${doc.id}`, JSON.stringify(data));
        });
    }

    async mergeLocalData() {
        if (!this.uid) return;
        console.log('[VAILISM CLOUD] Merging local data to cloud...');
        const batch = writeBatch(db);
        let hasChanges = false;

        // Merge Watchlist
        try {
            const localWatchlistRaw = localStorage.getItem('vailism_watchlist');
            if (localWatchlistRaw) {
                const wl = JSON.parse(localWatchlistRaw);
                if (wl && Array.isArray(wl.items)) {
                    wl.items.forEach(item => {
                        const docRef = doc(db, `users/${this.uid}/watchlist`, String(item.tmdbId));
                        batch.set(docRef, { ...item, _mergedAt: serverTimestamp() }, { merge: true });
                        hasChanges = true;
                    });
                }
            }
        } catch(e) { console.error('Watchlist merge error', e); }

        // Merge Progress
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('vailism_progress_')) {
                const id = key.replace('vailism_progress_', '');
                try {
                    const data = JSON.parse(localStorage.getItem(key));
                    const docRef = doc(db, `users/${this.uid}/progress`, String(id));
                    batch.set(docRef, { ...data, _mergedAt: serverTimestamp() }, { merge: true });
                    hasChanges = true;
                } catch(e) {}
            }
        }

        if (hasChanges) {
            await batch.commit();
            console.log('[VAILISM CLOUD] Local data merged successfully.');
        }
    }

    async syncProgress(progress) {
        if (!this.uid) return;
        const id = progress.contentId || progress.tmdbId;
        if (!id) return;
        
        const docRef = doc(db, `users/${this.uid}/progress`, String(id));
        this.queueWrite(docRef, { ...progress, updatedAt: serverTimestamp() });
    }

    async syncWatchlistItem(item, isRemove = false) {
        if (!this.uid) return;
        if (!item || !item.tmdbId) return;

        // Local cache handles removals. CloudSyncManager handles cloud state.
        const docRef = doc(db, `users/${this.uid}/watchlist`, String(item.tmdbId));
        if (isRemove) {
            // Delete requires special handling, but writeBatch or direct delete works.
            // For queuing, let's execute directly for now or add to queue.
            try {
                // To keep it simple, direct delete (offline persistence handles this).
                import('./firebase-config.js').then(({deleteDoc}) => {
                    deleteDoc(docRef);
                });
            } catch(e) { console.error(e); }
        } else {
            this.queueWrite(docRef, { ...item, addedAt: serverTimestamp() });
        }
    }

    queueWrite(docRef, data) {
        if (!this.isOnline) {
            console.log('[VAILISM SYNC] Offline. Queuing write.');
            this.syncQueue.push({ ref: docRef, data });
            return;
        }
        
        // Execute immediately (Firestore's offline persistence also queues this natively)
        this.showSyncSpinner(true);
        setDoc(docRef, data, { merge: true })
            .then(() => {
                this.updateUI('Last synced just now.');
                setTimeout(() => this.showSyncSpinner(false), 500);
            })
            .catch(err => {
                console.error('[VAILISM FIRESTORE] Sync write failed', err);
                this.showSyncSpinner(false);
            });
    }

    async flushQueue() {
        if (this.syncQueue.length === 0) return;
        console.log(`[VAILISM SYNC] Flushing ${this.syncQueue.length} queued writes...`);
        const batch = writeBatch(db);
        
        this.syncQueue.forEach(item => {
            batch.set(item.ref, item.data, { merge: true });
        });
        
        try {
            this.showSyncSpinner(true);
            await batch.commit();
            this.syncQueue = [];
            this.updateUI('Last synced just now.');
            console.log('[VAILISM SYNC] Queue flushed.');
        } catch (err) {
            console.error('[VAILISM SYNC] Failed to flush queue', err);
        } finally {
            this.showSyncSpinner(false);
        }
    }
}

export const CloudSyncManager = new CloudSyncManagerImpl();
