// config/firebase.js
const admin = require('firebase-admin');

// Firebase Admin initialization logic
try {
    const serviceAccount = require('../firebase-service-account.json'); // Aapki private key ka path
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("Firebase Admin Initialized Successfully");
} catch (error) {
    console.error("Firebase Admin Initialization Error:", error);
}

module.exports = admin;