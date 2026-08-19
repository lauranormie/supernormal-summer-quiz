/* Local-only stand-in for the Firebase Realtime Database, so the quiz can be
   previewed without a project. Never loaded by index.html. */
window.firebase = (function () {
  var DATA = {}, listeners = [], SENTINEL = { ".sv": "timestamp" };

  function seg(p) { return String(p).split("/").filter(Boolean); }
  function deepGet(path) {
    var n = DATA;
    var parts = seg(path);
    for (var i = 0; i < parts.length; i++) {
      if (n === null || typeof n !== "object") return null;
      n = n[parts[i]];
      if (n === undefined) return null;
    }
    return n === undefined ? null : n;
  }
  function resolve(v) {
    if (v === SENTINEL || (v && v[".sv"] === "timestamp")) return Date.now();
    if (v && typeof v === "object") { for (var k in v) v[k] = resolve(v[k]); }
    return v;
  }
  function deepSet(path, val) {
    var parts = seg(path);
    if (!parts.length) { DATA = val || {}; return; }
    var n = DATA;
    for (var i = 0; i < parts.length - 1; i++) {
      if (typeof n[parts[i]] !== "object" || n[parts[i]] === null) n[parts[i]] = {};
      n = n[parts[i]];
    }
    var leaf = parts[parts.length - 1];
    if (val === null) delete n[leaf]; else n[leaf] = resolve(val);
  }
  function notify() {
    listeners.slice().forEach(function (l) {
      var v = l.path === ".info/connected" ? true
            : l.path === ".info/serverTimeOffset" ? 0
            : deepGet(l.path);
      l.cb({ val: function () { return v; } });
    });
  }
  function Ref(path) { this.path = path; }
  Ref.prototype.child = function (p) { return new Ref(this.path + "/" + p); };
  Ref.prototype.set = function (v) { deepSet(this.path, v); notify(); return Promise.resolve(); };
  Ref.prototype.update = function (obj) {
    for (var k in obj) deepSet(this.path + "/" + k, obj[k]);
    notify(); return Promise.resolve();
  };
  Ref.prototype.transaction = function (fn) {
    var cur = deepGet(this.path);
    var res = fn(cur);
    if (res !== undefined) { deepSet(this.path, res); notify(); }
    return Promise.resolve({ committed: res !== undefined });
  };
  Ref.prototype.on = function (evt, cb) {
    listeners.push({ path: this.path, cb: cb });
    var v = this.path === ".info/connected" ? true
          : this.path === ".info/serverTimeOffset" ? 0
          : deepGet(this.path);
    cb({ val: function () { return v; } });
    return cb;
  };
  Ref.prototype.onDisconnect = function () {
    return { update: function () { return Promise.resolve(); } };
  };
  return {
    initializeApp: function () {},
    database: Object.assign(function () { return { ref: function (p) { return new Ref(p); } }; },
      { ServerValue: { TIMESTAMP: SENTINEL } })
  };
})();
window.firebase.database.ServerValue = { TIMESTAMP: { ".sv": "timestamp" } };
