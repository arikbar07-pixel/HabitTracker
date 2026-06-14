/* Firebase sync layer — loaded before app.js */
(function () {
  const CFG = {
    apiKey:            'AIzaSyAKBQJfqr8Ik2p9HlkSwNxePPTUkv0ktos',
    authDomain:        'myhabits-66e88.firebaseapp.com',
    projectId:         'myhabits-66e88',
    storageBucket:     'myhabits-66e88.firebasestorage.app',
    messagingSenderId: '730304793049',
    appId:             '1:730304793049:web:122e976cbd34a96bdb31c8'
  };

  firebase.initializeApp(CFG);

  const auth = firebase.auth();
  const db   = firebase.firestore();
  let _uid   = null;
  let _unsub = null;

  window.FB = {
    onAuth(cbIn, cbOut) {
      auth.onAuthStateChanged(u => {
        _uid = u ? u.uid : null;
        u ? cbIn(u) : cbOut();
      });
    },
    signIn() {
      const p = new firebase.auth.GoogleAuthProvider();
      p.setCustomParameters({ login_hint: 'arik.bar07@gmail.com' });
      auth.signInWithPopup(p).catch(console.warn);
    },
    signOut() { auth.signOut(); },
    getUser() { return auth.currentUser; },

    async save(data) {
      if (!_uid) return;
      try {
        await db.doc('users/' + _uid).set({ d: JSON.stringify(data), ts: Date.now() });
      } catch (e) { console.warn('FB save:', e); }
    },

    async load() {
      if (!_uid) return null;
      try {
        const s = await db.doc('users/' + _uid).get();
        return s.exists ? JSON.parse(s.data().d) : null;
      } catch (e) { return null; }
    },

    listen(cb) {
      if (_unsub) _unsub();
      if (!_uid) return;
      _unsub = db.doc('users/' + _uid).onSnapshot(s => {
        if (!s.exists || s.metadata.hasPendingWrites) return;
        try { cb(JSON.parse(s.data().d)); } catch (e) {}
      });
    },

    stopListen() { if (_unsub) { _unsub(); _unsub = null; } }
  };
})();
