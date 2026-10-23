/* Exam Studio storage: IndexedDB (local to this browser profile). No network, no cloud sync. */
(function (root) {
  'use strict';
  var DB_NAME = 'exam-studio', DB_VERSION = 1;
  var STORES = ['banks', 'questions', 'imports', 'log'];
  var dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      if (!root.indexedDB) { reject(new Error('IndexedDB is not available in this browser.')); return; }
      var req = root.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        STORES.forEach(function (s) { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' }); });
        // log entries get generated ids
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbp;
  }

  function tx(store, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode), s = t.objectStore(store), out = fn(s);
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : undefined); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('Transaction aborted')); };
      });
    });
  }

  function getAll(store) { return tx(store, 'readonly', function (s) { return s.getAll(); }); }
  function put(store, item) { return tx(store, 'readwrite', function (s) { s.put(item); }); }
  function putMany(store, items) { return tx(store, 'readwrite', function (s) { items.forEach(function (i) { s.put(i); }); }); }
  function del(store, id) { return tx(store, 'readwrite', function (s) { s.delete(id); }); }
  function delMany(store, ids) { return tx(store, 'readwrite', function (s) { ids.forEach(function (i) { s.delete(i); }); }); }

  root.ESDB = { open: open, getAll: getAll, put: put, putMany: putMany, del: del, delMany: delMany };
})(typeof self !== 'undefined' ? self : this);
