# Supernormal Summer Quiz

A live, host-led quiz for the team. One person hosts and drives the pace. Everyone
else opens the same link, picks a name and an emoji, and answers along. Scores
update for everybody in real time.

20 questions, 25 seconds each, roughly 30 minutes with banter.

## How a round runs

1. Everyone opens the link and joins. The first person in gets the host controls.
   The host runs the round and does not compete: they see each answer marked in
   advance so they can read it out, and they stay off the leaderboard.
2. The host presses **Start the quiz**. Everyone sees question 1 at the same time.
3. People answer by clicking a lane, or pressing keys 1 to 4.
4. The host presses **Reveal the answer**, then **Next question**.
5. Running short on time? The host can press **Finish here** at any reveal to jump
   straight to the results.

Scoring is 100 points for a correct answer, plus up to 50 more for speed. There is
a clock in the top bar counting up to the 30 minute mark so the host can pace it.

## Password

The quiz is behind a password so passers-by cannot wander in. It is currently
**suns-out-guns-0ut** (note the zero in the last `0ut`). Share it with the team alongside the link.

Only a SHA-256 hash of it lives in `app.js`, and the unlock is remembered per
browser, so people type it once. To change it, run this and paste the result over
`PASS_HASH` in `app.js`:

```
node -e "crypto.subtle.digest('SHA-256',new TextEncoder().encode('YOURPASS')).then(b=>console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')))"
```

What the password does and does not do: it stops someone stumbling onto the page
and playing or messing with the leaderboard. It does **not** hide the questions.
`data.js` is a static file on a public site, so anyone can request it directly and
read the answers, password or not. For a team quiz that is the right trade-off. If
you ever need the answers genuinely hidden, they would have to be encrypted rather
than merely gated.

## Setup

The quiz needs a Firebase Realtime Database to share scores between players. It is
free and takes about ten minutes.

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and
   create a project. Turn Google Analytics off, it is not needed.
2. In the left sidebar pick **Build > Realtime Database**, then **Create Database**.
   Choose a location and start in **locked mode**.
3. Open the **Rules** tab, paste in the contents of `database.rules.json` from this
   repo, and publish.
4. Go to **Project settings > General**, scroll to **Your apps**, and add a **Web**
   app. Copy the `firebaseConfig` object it shows you.
5. Paste those values over the placeholders at the top of `app.js`, then commit and
   push.

Until step 5 is done the page shows a setup card instead of the quiz, so you will
know if something is missing.

## Deploying

Push to GitHub, then **Settings > Pages**, source **Deploy from a branch**, branch
`main`, folder `/ (root)`. The link is `https://<user>.github.io/<repo>/`.

## Read this before making the repo public

The questions in `data.js` contain internal Supernormal detail: marketing campaign
numbers, Search Console figures, activation rates, and team specifics. A public
GitHub repo puts all of that on the open internet.

Options, roughly in order of preference:

- Use a **private repo**. GitHub Pages from a private repo needs Pro or an org plan.
- **Swap the sensitive questions** in `data.js` for general ones before publishing.
- Keep the repo public and accept it.

The same applies to the database. The rules above let anyone who has the database
URL read and write the quiz rooms, and that URL sits in `app.js`. That is a normal
trade-off for a throwaway static app, but it does mean the room is not private.
When the quiz is over, either set the rules to `false` or delete the Firebase
project.

## The drawing round

One item in `data.js` is `type: "draw"` instead of a multiple choice question.
Everyone gets 90 seconds on a shared canvas, then the drawings appear in a gallery
and people vote. Each vote is worth 50 points to the artist, nobody can vote for
their own, and the host neither draws nor votes.

Drawings are stored as compressed WebP data URLs on the player's answer, around
15 to 25KB each, so a full round sits comfortably inside the Firebase free tier.

Work in progress is sent automatically if the clock runs out or the host shows the
gallery early, so nobody loses a drawing by forgetting to press Done.

Tunable at the top of `app.js`: `DRAW_SECONDS` and `VOTE_POINTS`.

## Bump the version when you deploy

GitHub Pages serves `app.js` and `data.js` with `cache-control: max-age=600`, so for
ten minutes after a change some browsers keep running the old files. During a live
round that could put two players on different question sets.

So whenever you change `app.js` or `data.js`, bump the `?v=` number on both script
tags in `index.html`:

```html
<script src="data.js?v=3"></script>
<script src="app.js?v=3"></script>
```

That makes the change take effect immediately for everyone.

## Editing the questions

Everything is in `data.js`:

- `QUESTIONS` is an array of `{ q, a, c, why }`. `a` is the four options, `c` is the
  zero-based index of the correct one, and `why` is the line shown on the reveal.
- `EMOJI` is the set players choose from.
- `LOBBY_IMG` is the lobby picture, inlined as a data URI.

Add or remove questions freely. The counts, the perfect-score total and the progress
chip all read from the array length.

## Rooms

Add `?room=anything` to the link to run a separate game with its own scores, for
example `.../?room=friday-round-two`. Without it everyone shares `summer-2026`.

## Previewing without Firebase

`dev/preview.html` runs the whole quiz against an in-memory stand-in for the
database, so you can click through it locally:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000/dev/preview.html`. State is per-tab and resets on
reload, so it is for checking layout and flow, not for a real round.

## Credits

Soundtrack: *Like Yesterday* by Brian Dear.
