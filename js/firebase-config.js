import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getAuth, setPersistence, browserLocalPersistence, browserSessionPersistence, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut, sendPasswordResetEmail, onAuthStateChanged, updateProfile } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { getFirestore, enableIndexedDbPersistence, doc, setDoc, getDoc, getDocs, collection, writeBatch, serverTimestamp, deleteDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const firebaseConfig = {
    apiKey: atob("QUl6YVN5Q212STZvN3V0QjJhOFlBaGxNVXowVWJja19uNWVGQWdv"),
    authDomain: "vailism-netflix.firebaseapp.com",
    projectId: "vailism-netflix",
    storageBucket: "vailism-netflix.firebasestorage.app",
    messagingSenderId: "781010832644",
    appId: "1:781010832644:web:2facdda1b9559e3024d451"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Enable Firestore offline persistence
enableIndexedDbPersistence(db).catch((err) => {
    if (err.code == 'failed-precondition') {
        console.warn('[VAILISM FIRESTORE] Multiple tabs open, offline persistence is disabled for this tab.');
    } else if (err.code == 'unimplemented') {
        console.warn('[VAILISM FIRESTORE] The current browser does not support all of the features required to enable persistence.');
    }
});

export { app, auth, db, setPersistence, browserLocalPersistence, browserSessionPersistence, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut, sendPasswordResetEmail, onAuthStateChanged, updateProfile, doc, setDoc, getDoc, getDocs, collection, writeBatch, serverTimestamp, deleteDoc };
