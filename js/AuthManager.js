import { 
    auth, db, setPersistence, browserLocalPersistence, browserSessionPersistence, 
    signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, 
    GoogleAuthProvider, signOut, sendPasswordResetEmail, onAuthStateChanged, 
    updateProfile, doc, setDoc, serverTimestamp 
} from './firebase-config.js';

import { CloudSyncManager } from './cloud-sync.js';

class AuthManager {
    constructor() {
        this.auth = auth;
        this.db = db;
        this.googleProvider = new GoogleAuthProvider();
        this.googleProvider.setCustomParameters({ prompt: 'select_account' });
        
        // Listeners for auth state
        this.authListeners = [];
        onAuthStateChanged(this.auth, this.handleAuthStateChange.bind(this));
    }

    onAuthStateChanged(callback) {
        this.authListeners.push(callback);
        // Trigger immediately if already loaded
        if (this.auth.currentUser) {
            callback(this.auth.currentUser);
        }
    }

    async handleAuthStateChange(user) {
        if (user) {
            console.log(`[VAILISM AUTH] Logged in as ${user.email}`);
            await CloudSyncManager.bootstrapUser(user.uid);
        } else {
            console.log('[VAILISM AUTH] User signed out');
            CloudSyncManager.clearLocalState();
        }
        // Notify subscribers
        this.authListeners.forEach(cb => cb(user));
    }

    async setPersistenceMode(rememberMe) {
        const persistence = rememberMe ? browserLocalPersistence : browserSessionPersistence;
        await setPersistence(this.auth, persistence);
    }

    async signUp(email, password, username) {
        try {
            const userCredential = await createUserWithEmailAndPassword(this.auth, email, password);
            const user = userCredential.user;
            await updateProfile(user, { displayName: username });
            
            // Initialize basic Firestore user document
            const userRef = doc(this.db, 'users', user.uid);
            await setDoc(userRef, {
                email: user.email,
                username: username,
                createdAt: serverTimestamp()
            }, { merge: true });
            
            return { user, error: null };
        } catch (error) {
            console.error('[VAILISM AUTH] Sign Up Error:', error);
            return { user: null, error: this.mapAuthError(error) };
        }
    }

    async signIn(email, password, rememberMe = true) {
        try {
            await this.setPersistenceMode(rememberMe);
            const userCredential = await signInWithEmailAndPassword(this.auth, email, password);
            return { user: userCredential.user, error: null };
        } catch (error) {
            console.error('[VAILISM AUTH] Sign In Error:', error);
            return { user: null, error: this.mapAuthError(error) };
        }
    }

    async signInWithGoogle() {
        try {
            await this.setPersistenceMode(true);
            const userCredential = await signInWithPopup(this.auth, this.googleProvider);
            const user = userCredential.user;
            
            // Ensure document exists
            const userRef = doc(this.db, 'users', user.uid);
            await setDoc(userRef, {
                email: user.email,
                username: user.displayName || 'Google User',
                lastLogin: serverTimestamp()
            }, { merge: true });

            return { user, error: null };
        } catch (error) {
            console.error('[VAILISM AUTH] Google Sign In Error:', error);
            return { user: null, error: this.mapAuthError(error) };
        }
    }

    async signOut() {
        try {
            await signOut(this.auth);
            return { success: true, error: null };
        } catch (error) {
            return { success: false, error: this.mapAuthError(error) };
        }
    }

    async resetPassword(email) {
        try {
            await sendPasswordResetEmail(this.auth, email);
            return { success: true, error: null };
        } catch (error) {
            return { success: false, error: this.mapAuthError(error) };
        }
    }

    mapAuthError(error) {
        switch (error.code) {
            case 'auth/invalid-email':
                return 'Invalid email address format.';
            case 'auth/user-disabled':
                return 'This account has been disabled.';
            case 'auth/user-not-found':
            case 'auth/wrong-password':
            case 'auth/invalid-credential':
                return 'Invalid email or password.';
            case 'auth/email-already-in-use':
                return 'An account with this email already exists.';
            case 'auth/weak-password':
                return 'Password is too weak. Use at least 6 characters.';
            case 'auth/popup-closed-by-user':
                return 'Google sign-in was cancelled.';
            case 'auth/network-request-failed':
                return 'Network error. Please check your connection.';
            default:
                return error.message || 'An unexpected error occurred.';
        }
    }
}

// Export a singleton instance
export const authManager = new AuthManager();
