// firebase.js — Tucker's Camp Lite
// Same Firebase project as original app: tucker-s-camp

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyDIosqJQaBSOPageOLTU9I3CgPjEirFz7M",
  authDomain: "tucker-s-camp.firebaseapp.com",
  projectId: "tucker-s-camp",
  storageBucket: "tucker-s-camp.firebasestorage.app",
  messagingSenderId: "12406844593",
  appId: "1:12406844593:web:ae373da3629809e94d4690",
  measurementId: "G-5B9B9M2Z8P"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
