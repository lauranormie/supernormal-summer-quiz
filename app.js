/* Supernormal Summer Quiz - live host-led round, Firebase Realtime Database. */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ config */
  /* Paste the config from Firebase console: Project settings > Your apps > Web. */
  var firebaseConfig = window.__SQ_CONFIG__ || {
    apiKey: "AIzaSyAnbi2E-TqRDQ_KzI8fYspZ1ud35b2xoeQ",
    authDomain: "supernormal-summer-quiz.firebaseapp.com",
    databaseURL: "https://supernormal-summer-quiz-default-rtdb.firebaseio.com",
    projectId: "supernormal-summer-quiz",
    storageBucket: "supernormal-summer-quiz.firebasestorage.app",
    messagingSenderId: "54727944185",
    appId: "1:54727944185:web:26618462a8cb851f44ff28"
  };

  /* SHA-256 of the room password. To change it, run:
     node -e "crypto.subtle.digest('SHA-256',new TextEncoder().encode('YOURPASS')).then(b=>console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')))"
     Current password: suns-out-guns-0ut */
  var PASS_HASH = "47d0605f9e7ac66440f280933e13b3dc94938dd30d4da4b9900102fdf0c27adf";

  var SECONDS = 25;
  var TARGET_MIN = 30;
  var ROOM = ((new URLSearchParams(location.search).get("room") || "summer-2026")
    .replace(/[^a-z0-9-]/gi, "").slice(0, 40)) || "summer-2026";

  /* ------------------------------------------------------------------ state */
  var BLANK = { phase: "lobby", qIndex: 0, startedAt: null, roundStartedAt: null,
                hostId: null, players: {} };
  var state = BLANK;
  var db = null, ref = null, skew = 0, connected = false, fatal = null, gateWrong = false;

  function now() { return Date.now() + skew; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function normalize(v) {
    var s = v || {};
    return {
      phase: s.phase || "lobby",
      qIndex: typeof s.qIndex === "number" ? s.qIndex : 0,
      startedAt: s.startedAt || null,
      roundStartedAt: s.roundStartedAt || null,
      hostId: s.hostId || null,
      players: s.players || {}
    };
  }

  /* ------------------------------------------------------------------ me */
  function getMe() {
    var id = null, name = "";
    try { id = localStorage.getItem("sq_id"); name = localStorage.getItem("sq_name") || ""; } catch (e) {}
    if (!id) {
      id = "p" + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem("sq_id", id); } catch (e) {}
    }
    return { id: id, name: name };
  }
  var me = getMe();
  function setName(n) { me.name = n; try { localStorage.setItem("sq_name", n); } catch (e) {} }

  var myEmoji = null;
  try { myEmoji = localStorage.getItem("sq_emoji"); } catch (e) {}
  if (EMOJI.indexOf(myEmoji) === -1) {
    myEmoji = EMOJI[Math.floor(Math.random() * EMOJI.length)];
    try { localStorage.setItem("sq_emoji", myEmoji); } catch (e) {}
  }

  function joined() {
    var p = state.players[me.id];
    return !!(p && p.name);
  }
  function isHost() { return state.hostId === me.id; }
  function avatarOf(id) {
    var p = state.players[id];
    return p && EMOJI.indexOf(p.emoji) !== -1 ? p.emoji : "";
  }
  function answersOf(p) { return (p && p.answers) || {}; }

  /* ------------------------------------------------------------------ scoring */
  function scoreFor(ms) { return 100 + Math.round(50 * Math.max(0, 1 - ms / (SECONDS * 1000))); }
  function totalFor(p) {
    var a = answersOf(p), t = 0;
    for (var k in a) if (a[k] && a[k].pts) t += a[k].pts;
    return t;
  }
  function ranked() {
    var out = [];
    for (var id in state.players) {
      var p = state.players[id];
      if (!p || !p.name) continue;
      out.push({ id: id, name: p.name, emoji: avatarOf(id),
                 score: totalFor(p), joinedAt: p.joinedAt || 0 });
    }
    out.sort(function (a, b) { return b.score - a.score || a.joinedAt - b.joinedAt; });
    return out;
  }
  function answeredCount() {
    var n = 0;
    for (var id in state.players) {
      var p = state.players[id];
      if (p && p.name && answersOf(p)[state.qIndex]) n++;
    }
    return n;
  }
  function playerCount() {
    var n = 0;
    for (var id in state.players) if (state.players[id] && state.players[id].name) n++;
    return n;
  }

  /* ------------------------------------------------------------------ writes */
  function TS() { return firebase.database.ServerValue.TIMESTAMP; }

  function doJoin() {
    var el = document.getElementById("nm");
    var n = (el && el.value || "").trim().slice(0, 24);
    if (!n) { if (el) el.focus(); return; }
    setName(n);
    ref.child("players/" + me.id).update({ name: n, emoji: myEmoji, joinedAt: TS() });
    ref.child("hostId").transaction(function (cur) { return cur === null ? me.id : undefined; });
  }
  function doAnswer(i) {
    if (state.phase !== "question" || !joined()) return;
    if (answersOf(state.players[me.id])[state.qIndex]) return;
    var ms = Math.min(SECONDS * 1000, Math.max(0, now() - (state.startedAt || now())));
    var right = QUESTIONS[state.qIndex] && QUESTIONS[state.qIndex].c === i;
    ref.child("players/" + me.id + "/answers/" + state.qIndex)
       .transaction(function (cur) {
         return cur === null ? { choice: i, ms: ms, pts: right ? scoreFor(ms) : 0 } : undefined;
       });
  }
  function hostAct(act) {
    if (act === "start") ref.update({ phase: "question", qIndex: 0, startedAt: TS(), roundStartedAt: TS() });
    else if (act === "reveal") ref.update({ phase: "reveal" });
    else if (act === "next") {
      if (state.qIndex + 1 >= QUESTIONS.length) ref.update({ phase: "final", startedAt: null });
      else ref.update({ phase: "question", qIndex: state.qIndex + 1, startedAt: TS() });
    }
    else if (act === "finish") ref.update({ phase: "final", startedAt: null });
    else if (act === "reset") {
      var up = { phase: "lobby", qIndex: 0, startedAt: null, roundStartedAt: null };
      for (var id in state.players) up["players/" + id + "/answers"] = null;
      ref.update(up);
    }
    else if (act === "takehost") ref.child("hostId").set(me.id);
  }

  /* ------------------------------------------------------------------ clock */
  function fmtClock(ms) {
    var t = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(t / 60), s = t % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  function clockClass(ms) {
    return "chip clock" + (ms > TARGET_MIN * 60000 ? " over"
      : ms > (TARGET_MIN - 5) * 60000 ? " near" : "");
  }
  function clockHtml() {
    if (!state.roundStartedAt || state.phase === "lobby") return "";
    var ms = now() - state.roundStartedAt;
    return '<div class="' + clockClass(ms) + '" id="clock" title="Time into the round">' +
      fmtClock(ms) + " / " + TARGET_MIN + ":00</div>";
  }
  function updateClock() {
    var el = document.getElementById("clock");
    if (!el || !state.roundStartedAt) return;
    var ms = now() - state.roundStartedAt;
    el.textContent = fmtClock(ms) + " / " + TARGET_MIN + ":00";
    el.className = clockClass(ms);
  }

  /* ------------------------------------------------------------------ views */
  function topbar() {
    var b = ['<div class="bar"><div class="mark">Supernormal <span>Summer Quiz</span></div>'];
    if (state.phase === "question" || state.phase === "reveal") {
      b.push('<div class="chip hot">Q' + (state.qIndex + 1) + " / " + QUESTIONS.length + "</div>");
    } else if (state.phase === "final") b.push('<div class="chip live">Results</div>');
    else b.push('<div class="chip">Lobby</div>');
    b.push(clockHtml());
    b.push('<div class="sp"></div>');
    if (!connected) b.push('<div class="chip">Connecting…</div>');
    if (joined()) {
      b.push('<div class="chip">' + esc(avatarOf(me.id)) + " " +
        esc(state.players[me.id].name) + " &middot; " + totalFor(state.players[me.id]) + " pts</div>");
    }
    if (isHost()) b.push('<div class="chip hostchip">Host</div>');
    b.push("</div>");
    return b.join("");
  }

  function heroHtml(sm) {
    return '<img class="hero' + (sm ? " s" : "") + '" src="' + LOBBY_IMG +
      '" width="520" height="520" alt="The Supernormal mark on a sun lounger with a cocktail and a book">';
  }
  function emojiPicker() {
    return '<div class="picker" role="group" aria-label="Pick your emoji">' +
      EMOJI.map(function (e) {
        var on = e === myEmoji;
        return '<button type="button" class="emo' + (on ? " on" : "") + '" data-emo="' + e +
          '" aria-pressed="' + (on ? "true" : "false") + '" aria-label="Pick ' + e + '">' + e + "</button>";
      }).join("") + "</div>";
  }
  function trackHtml() {
    return '<div class="track"><span class="ico">🎧</span>' +
      '<span class="meta"><b>Soundtrack: Like Yesterday</b><span>by Brian Dear</span></span>' +
      '<a href="https://open.spotify.com/track/6T92OcYN07AEjWI152YJGX" target="_blank" ' +
      'rel="noopener noreferrer">Play on Spotify</a></div>';
  }
  function lobbyList() {
    var r = ranked();
    if (!r.length) return '<p class="muted">Nobody has joined yet. You could be first.</p>';
    return '<div><div class="eyebrow" style="margin-bottom:10px">In the lobby &middot; ' + r.length +
      '</div><div class="pills">' + r.map(function (p) {
        return '<span class="pill' + (p.id === me.id ? " on" : "") + '">' +
          (p.emoji ? '<span class="av">' + esc(p.emoji) + "</span>" : '<i class="dot"></i>') +
          esc(p.name) + (p.id === state.hostId ? " &middot; host" : "") + "</span>";
      }).join("") + "</div></div>";
  }

  function hostControls() {
    if (!isHost()) return "";
    var inner = "";
    if (state.phase === "lobby") {
      inner = '<div class="row"><button class="btn host" data-act="start"' +
        (playerCount() ? "" : " disabled") + ">Start the quiz</button>" +
        '<span class="muted">' + playerCount() + " in the lobby</span></div>";
    } else if (state.phase === "question") {
      inner = '<div class="row"><button class="btn host" data-act="reveal">Reveal the answer</button></div>';
    } else if (state.phase === "reveal") {
      var last = state.qIndex + 1 >= QUESTIONS.length;
      inner = '<div class="row"><button class="btn host" data-act="next">' +
        (last ? "Show final results" : "Next question") + "</button>" +
        (last ? "" : '<button class="btn ghost" data-act="finish">Finish here</button>' +
          '<span class="muted">' + (QUESTIONS.length - state.qIndex - 1) + " questions left</span>") + "</div>";
    } else {
      inner = '<div class="row"><button class="btn ghost" data-act="reset">Reset for another round</button>' +
        '<span class="muted">Clears every score and keeps everyone in the lobby.</span></div>';
    }
    return '<div class="hostbox"><div class="lbl">Host controls: Only you see these</div>' + inner + "</div>";
  }

  function viewJoin() {
    return "<main>" +
      '<div class="intro"><div class="introtext">' +
      '<div class="eyebrow">Live team round &middot; ' + QUESTIONS.length + " questions</div>" +
      "<h1>Come on in, the water's Super</h1>" +
      '<p class="lede">' + QUESTIONS.length + " questions about Supernormal, the team, and the summer, " +
      "answered together, live. The fastest correct answer takes the most points. " +
      "The host drives the pace, so all you do is pick a lane.</p></div>" +
      heroHtml() + "</div>" +
      '<div class="card">' +
      '<div class="field"><label class="eyebrow" for="nm">1. Name</label>' +
      '<input id="nm" type="text" placeholder="e.g. Laura" maxlength="24" ' +
      'autocomplete="off" value="' + esc(me.name) + '"></div>' +
      '<div class="field"><span class="eyebrow">2. Emoji</span>' + emojiPicker() +
      '<p class="muted">Your name and emoji show on the board all round.</p></div>' +
      '<div class="row"><button class="btn" data-act="join">Join the quiz</button></div></div>' +
      trackHtml() + lobbyList() + "</main>";
  }

  function viewLobby() {
    var hn = state.hostId && state.players[state.hostId] ? state.players[state.hostId].name : null;
    return "<main>" +
      '<div class="intro"><div class="introtext">' +
      '<div class="eyebrow">Live team round &middot; ' + QUESTIONS.length + " questions</div>" +
      "<h1>You are in. Wait for the whistle.</h1></div>" + heroHtml(true) + "</div>" +
      '<p class="lede">' + (hn ? esc(hn) + " starts the round when everyone has arrived."
        : "Nobody is hosting yet. Someone needs to take the controls.") + "</p>" +
      lobbyList() + trackHtml() + hostControls() +
      '<div class="note"><b>How scoring works.</b> A correct answer is 100 points, plus up to 50 more ' +
      "for speed. There are " + SECONDS + " seconds on each question. Wrong answers cost you " +
      "nothing, so it is always worth a guess.</div></main>";
  }

  function viewQuestion() {
    var q = QUESTIONS[state.qIndex];
    var mine = joined() ? answersOf(state.players[me.id])[state.qIndex] : null;
    var elapsed = (now() - (state.startedAt || now())) / 1000;
    var expired = elapsed >= SECONDS;
    var locked = !!mine || expired || !joined();
    var lanes = q.a.map(function (t, i) {
      return '<button class="lane' + (mine && mine.choice === i ? " pick" : "") +
        '" data-pick="' + i + '"' + (locked ? " disabled" : "") + '>' +
        '<span class="n">' + (i + 1) + "</span><span>" + esc(t) + "</span>" +
        (mine && mine.choice === i ? '<span class="tag">locked in</span>' : "") + "</button>";
    }).join("");
    var timer = expired ? '<div class="timer done"><i></i></div>'
      : '<div class="timer"><i style="animation-duration:' + SECONDS +
        "s;animation-delay:-" + elapsed.toFixed(2) + 's"></i></div>';
    var status = !joined() ? "You are not in this round."
      : mine ? "Answer locked. Waiting for everyone else."
      : expired ? "Time is up. Waiting on the host."
      : "Pick a lane. Keys 1 to 4 work too.";
    return "<main>" + timer +
      '<div><div class="eyebrow">Question ' + (state.qIndex + 1) + " of " + QUESTIONS.length +
      '</div><h2 class="q-text" style="margin-top:10px">' + esc(q.q) + "</h2></div>" +
      '<div class="lanes">' + lanes + "</div>" +
      '<div class="row" style="justify-content:space-between">' +
      '<span class="muted">' + status + "</span>" +
      '<span class="chip">' + answeredCount() + " / " + playerCount() + " answered</span></div>" +
      hostControls() + "</main>";
  }

  function boardHtml(limit) {
    var r = ranked(), top = r.length ? Math.max(r[0].score, 1) : 1;
    var rows = r.slice(0, limit || r.length).map(function (p, i) {
      var last = answersOf(state.players[p.id])[state.qIndex];
      var delta = (state.phase === "reveal" && last && last.pts)
        ? '<span class="delta">+' + last.pts + "</span>" : "";
      return '<div class="slot' + (p.id === me.id ? " me" : "") +
        (i === 0 && p.score > 0 ? " top1" : "") + '">' +
        '<span class="fill" style="width:' + Math.round(p.score / top * 100) + '%"></span>' +
        '<span class="rank">' + (i + 1) + "</span>" +
        '<span class="av">' + esc(p.emoji) + "</span>" +
        '<span class="who">' + esc(p.name) + "</span>" + delta +
        '<span class="pts">' + p.score + "</span></div>";
    }).join("");
    return '<div class="board">' + (rows || '<p class="muted">Nobody on the board yet.</p>') + "</div>";
  }

  function viewReveal() {
    var q = QUESTIONS[state.qIndex];
    var mine = joined() ? answersOf(state.players[me.id])[state.qIndex] : null;
    var lanes = q.a.map(function (t, i) {
      var cls = "lane" + (i === q.c ? " right" : (mine && mine.choice === i ? " wrong" : ""));
      var tag = i === q.c ? '<span class="tag">correct</span>'
        : (mine && mine.choice === i ? '<span class="tag">your pick</span>' : "");
      return '<button class="' + cls + '" disabled><span class="n">' + (i + 1) + "</span>" +
        "<span>" + esc(t) + "</span>" + tag + "</button>";
    }).join("");
    var verdict = !joined() ? '<div class="eyebrow">The answer</div>'
      : (mine && mine.choice === q.c)
        ? '<div class="eyebrow" style="color:var(--right)">Correct &middot; +' + mine.pts + " points</div>"
      : mine ? '<div class="eyebrow" style="color:var(--wrong)">Not this time</div>'
      : '<div class="eyebrow" style="color:var(--wrong)">You did not answer</div>';
    return "<main>" + verdict + '<h2 class="q-text">' + esc(q.q) + "</h2>" +
      '<div class="lanes">' + lanes + "</div>" +
      '<div class="note">' + q.why + "</div>" +
      '<div><div class="eyebrow" style="margin-bottom:10px">Standings</div>' + boardHtml(6) + "</div>" +
      hostControls() + "</main>";
  }

  function viewFinal() {
    var r = ranked(), medals = ["🥇", "🥈", "🥉"];
    var pods = [0, 1, 2].map(function (i) {
      var p = r[i];
      if (!p) return "";
      return '<div class="pod' + (i === 0 ? " g" : "") + '"><div class="medal">' + medals[i] +
        '</div><div class="av big">' + esc(p.emoji) + '</div><div class="nm">' + esc(p.name) +
        '</div><div class="sc">' + p.score + " pts</div></div>";
    }).join("");
    var best = r.length ? r[0] : null;
    return '<main class="wide">' +
      '<div><div class="eyebrow">That is the round</div><h1>' +
      (best ? esc(best.name) + " takes it" : "No scores this round") + "</h1></div>" +
      (pods ? '<div class="podium">' + pods + "</div>" : "") +
      '<div class="stat"><div><span class="k">Players</span><span class="v">' + r.length +
      '</span></div><div><span class="k">Questions</span><span class="v">' + QUESTIONS.length +
      '</span></div><div><span class="k">Top score</span><span class="v good">' +
      (best ? best.score : 0) + '</span></div><div><span class="k">Perfect round</span>' +
      '<span class="v brand">' + QUESTIONS.length * 150 + "</span></div></div>" +
      '<div><div class="eyebrow" style="margin-bottom:10px">Full leaderboard</div>' +
      boardHtml() + "</div>" + trackHtml() + hostControls() + "</main>";
  }

  function footerHtml() {
    var b = ["<footer>"];
    var hn = state.hostId && state.players[state.hostId] ? state.players[state.hostId].name : null;
    if (state.hostId && !isHost()) {
      b.push("<span>Hosted by " + esc(hn || "someone who left") + ".</span>");
      if (joined()) b.push('<button data-act="takehost">Take over hosting</button>');
    } else if (!state.hostId && joined()) {
      b.push('<button data-act="takehost">Take the host controls</button>');
    }
    b.push('<span>Room: ' + esc(ROOM) + "</span>");
    b.push("</footer>");
    return b.join("");
  }

  /* ------------------------------------------------------------------ render */
  var ticking = null;
  function render() {
    var app = document.getElementById("app");
    if (fatal) { app.innerHTML = fatal; return; }
    if (!unlocked) {
      app.innerHTML = viewGate(gateWrong);
      var pw = document.getElementById("pw");
      if (pw && !("ontouchstart" in window)) pw.focus();
      return;
    }

    /* keep whatever the player is typing, since remote updates re-render */
    var act = document.activeElement;
    var keepId = act && act.id ? act.id : null;
    var keepVal = null, selA = null, selB = null;
    if (keepId === "nm") { keepVal = act.value; selA = act.selectionStart; selB = act.selectionEnd; }

    var body;
    if (state.phase === "lobby") body = joined() ? viewLobby() : viewJoin();
    else if (state.phase === "question") body = joined() ? viewQuestion() : viewJoin();
    else if (state.phase === "reveal") body = viewReveal();
    else body = viewFinal();
    app.innerHTML = topbar() + body + footerHtml();

    if (keepId) {
      var el = document.getElementById(keepId);
      if (el) {
        if (keepVal !== null) el.value = keepVal;
        el.focus();
        if (selA !== null) { try { el.setSelectionRange(selA, selB); } catch (e) {} }
      }
    } else if (state.phase === "lobby" && !joined()) {
      var nm = document.getElementById("nm");
      if (nm && !("ontouchstart" in window)) nm.focus();
    }

    if (ticking) { clearTimeout(ticking); ticking = null; }
    if (state.phase === "question") {
      var left = SECONDS * 1000 - (now() - (state.startedAt || now()));
      if (left > 0) ticking = setTimeout(render, Math.min(left + 60, 30000));
    }
  }

  /* ------------------------------------------------------------------ events */
  document.addEventListener("click", function (e) {
    if (!e.target || !e.target.closest) return;
    var emo = e.target.closest("[data-emo]");
    if (emo) {
      myEmoji = emo.getAttribute("data-emo");
      try { localStorage.setItem("sq_emoji", myEmoji); } catch (err) {}
      var all = document.querySelectorAll("[data-emo]");
      for (var k = 0; k < all.length; k++) {
        var on = all[k].getAttribute("data-emo") === myEmoji;
        all[k].classList.toggle("on", on);
        all[k].setAttribute("aria-pressed", on ? "true" : "false");
      }
      if (joined()) ref.child("players/" + me.id + "/emoji").set(myEmoji);
      return;
    }
    var pick = e.target.closest("[data-pick]");
    if (pick && !pick.disabled) { doAnswer(parseInt(pick.getAttribute("data-pick"), 10)); return; }
    var btn = e.target.closest("[data-act]");
    if (!btn || btn.disabled) return;
    var a = btn.getAttribute("data-act");
    if (a === "unlock") doUnlock();
    else if (a === "join") doJoin();
    else if (a === "finish") { if (confirm("End the round now and go straight to the results?")) hostAct(a); }
    else if (a === "reset") { if (confirm("Reset every score and go back to the lobby?")) hostAct(a); }
    else hostAct(a);
  });

  document.addEventListener("keydown", function (e) {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) {
      if (e.key === "Enter" && e.target.id === "nm") doJoin();
      if (e.key === "Enter" && e.target.id === "pw") doUnlock();
      return;
    }
    if (state.phase !== "question") return;
    var n = parseInt(e.key, 10);
    if (n >= 1 && n <= 4) doAnswer(n - 1);
  });

  /* ------------------------------------------------------------------ boot */
  function sha256Hex(str) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(str)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return b.toString(16).padStart(2, "0");
      }).join("");
    });
  }

  function viewGate(wrong) {
    return '<main><div class="intro"><div class="introtext">' +
      '<div class="eyebrow">Supernormal team round</div>' +
      "<h1>Come on in, the water's Super</h1>" +
      '<p class="lede">This one is just for the team. Pop in the password from Slack ' +
      'and you are through.</p></div>' + heroHtml() + '</div>' +
      '<div class="card"><div class="field">' +
      '<label class="eyebrow" for="pw">Password</label>' +
      '<input id="pw" type="password" autocomplete="off" placeholder="Password from Slack"></div>' +
      (wrong ? '<div class="banner">That is not it. Check the message in Slack and try again.</div>' : "") +
      '<div class="row"><button class="btn" data-act="unlock">Let me in</button></div></div></main>';
  }

  function setupCard() {
    return '<main><div class="intro"><div class="introtext">' +
      '<div class="eyebrow">Setup needed</div><h1>Add your Firebase config</h1>' +
      '<p class="lede">The quiz needs a Realtime Database to share scores between players. ' +
      'Open <b>app.js</b>, replace the placeholder values in <b>firebaseConfig</b> at the top, ' +
      'then commit and push. Full steps are in the README.</p></div>' + heroHtml() + '</div></main>';
  }

  var unlocked = false;
  try { unlocked = localStorage.getItem("sq_pass") === PASS_HASH; } catch (e) {}

  function doUnlock() {
    var el = document.getElementById("pw");
    var v = (el && el.value) || "";
    if (!v) { if (el) el.focus(); return; }
    sha256Hex(v).then(function (h) {
      if (h === PASS_HASH) {
        try { localStorage.setItem("sq_pass", h); } catch (e) {}
        unlocked = true;
        gateWrong = false;
        boot();
      } else {
        gateWrong = true;
        render();
        var f = document.getElementById("pw");
        if (f) { f.value = ""; f.focus(); }
      }
    });
  }

  function boot() {
  if (firebaseConfig.apiKey === "PASTE_API_KEY" || !firebaseConfig.databaseURL ||
      firebaseConfig.databaseURL.indexOf("PASTE") !== -1) {
    fatal = setupCard();
    render();
    return;
  }

  try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    ref = db.ref("rooms/" + ROOM);
  } catch (err) {
    fatal = '<main><div class="banner"><b>Could not reach the database.</b> ' +
      esc(err && err.message) + '</div></main>';
    render();
    return;
  }

  db.ref(".info/serverTimeOffset").on("value", function (s) { skew = s.val() || 0; });
  db.ref(".info/connected").on("value", function (s) {
    connected = !!s.val();
    render();
  });
  ref.on("value", function (snap) {
    state = normalize(snap.val());
    render();
  }, function (err) {
    fatal = '<main><div class="banner"><b>Could not read the quiz.</b> ' +
      'Check the database rules allow reads on <b>rooms/</b>. ' + esc(err && err.message) +
      '</div></main>';
    render();
  });

  render();
  }

  setInterval(updateClock, 1000);
  if (unlocked) boot(); else render();
})();
