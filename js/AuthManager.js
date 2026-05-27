class AuthManager {
    constructor() {
        if (typeof firebase === 'undefined' || !firebase.apps.length) {
            console.error('Firebase is not initialized.');
            return;
        }
        this.auth = firebase.auth();
        this.db = firebase.firestore();
        this.googleProvider = new firebase.auth.GoogleAuthProvider();
        this.googleProvider.setCustomParameters({ prompt: 'select_account' });
        
        // Listeners for auth state
        this.authListeners = [];
        this.auth.onAuthStateChanged(this.handleAuthStateChange.bind(this));
    }

    onAuthStateChanged(callback) {
        this.authListeners.push(callback);
        // Trigger immediately if already loaded
        if (this.auth.currentUser) {
            callback(this.auth.currentUser);
        }
    }

    handleAuthStateChange(user) {
        if (user) {
            this.bootstrapUser(user);
            this.syncUserData(user);
        }
        // Notify subscribers
        this.authListeners.forEach(cb => cb(user));
    }

    async setPersistence(rememberMe) {
        const persistence = rememberMe 
            ? firebase.auth.Auth.Persistence.LOCAL 
            : firebase.auth.Auth.Persistence.SESSION;
        await this.auth.setPersistence(persistence);
    }

    async signUp(email, password, username) {
        try {
            const userCredential = await this.auth.createUserWithEmailAndPassword(email, password);
            const user = userCredential.user;
            await user.updateProfile({ displayName: username });
            
            // Initialize basic Firestore user document
            await this.db.collection('users').doc(user.uid).set({
                email: user.email,
                username: username,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            
            return { user, error: null };
        } catch (error) {
            console.error('Sign Up Error:', error);
            return { user: null, error: this.mapAuthError(error) };
        }
    }

    async signIn(email, password, rememberMe = true) {
        try {
            await this.setPersistence(rememberMe);
            const userCredential = await this.auth.signInWithEmailAndPassword(email, password);
            return { user: userCredential.user, error: null };
        } catch (error) {
            console.error('Sign In Error:', error);
            return { user: null, error: this.mapAuthError(error) };
        }
    }

    async signInWithGoogle() {
        try {
            await this.setPersistence(true);
            const userCredential = await this.auth.signInWithPopup(this.googleProvider);
            const user = userCredential.user;
            
            // Ensure document exists
            await this.db.collection('users').doc(user.uid).set({
                email: user.email,
                username: user.displayName || 'Google User',
                lastLogin: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            return { user, error: null };
        } catch (error) {
            console.error('Google Sign In Error:', error);
            return { user: null, error: this.mapAuthError(error) };
        }
    }

    async signOut() {
        try {
            await this.auth.signOut();
            return { success: true, error: null };
        } catch (error) {
            return { success: false, error: this.mapAuthError(error) };
        }
    }

    async resetPassword(email) {
        try {
            await this.auth.sendPasswordResetEmail(email);
            return { success: true, error: null };
        } catch (error) {
            return { success: false, error: this.mapAuthError(error) };
        }
    }

    async syncUserData(user) {
        if (!user) return;
        // Centralized bootstrap sync operations.
    }

    async bootstrapUser(user) {
        if (!user) return;
        // Logic to pre-fetch any user specific cloud settings right after login
        console.log(`Bootstrapped user session for ${user.email}`);
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

// Make globally available
window.AuthManager = AuthManager;
