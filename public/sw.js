/**
 * Cold-start loading screen.
 *
 * The container app scales to zero when idle, so the first request after a
 * quiet spell waits ~20 s while Azure starts a replica — and the server can't
 * send anything until it's up. This service worker (installed on an earlier
 * visit) races each page navigation against a short timer: if the server
 * hasn't answered in time, it shows WAKING_PAGE straight from the browser.
 * That page pings a static file until the server answers, then reloads.
 *
 * Once a ping succeeds the server is known to be awake, and navigations go
 * straight to the network for WARM_MS, so a slow-but-awake page (e.g. Neon
 * resuming) can't loop between the loading screen and a reload.
 */

const RACE_MS = 2000;
const WARM_MS = 60_000;
const PING_PATH = "/manifest.webmanifest";

let warmUntil = 0;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The loading page's ping: pass it through and note when the server answers.
  if (url.pathname === PING_PATH && url.searchParams.has("wake")) {
    event.respondWith(
      fetch(request).then((res) => {
        if (res.ok) warmUntil = Date.now() + WARM_MS;
        return res;
      }),
    );
    return;
  }

  if (request.mode !== "navigate" || url.pathname.startsWith("/api/")) return;
  if (Date.now() < warmUntil) return;

  event.respondWith(raceNavigation(request));
});

function raceNavigation(request) {
  const network = fetch(request).then((res) => {
    warmUntil = Date.now() + WARM_MS;
    return res;
  });
  const timer = new Promise((resolve) => setTimeout(resolve, RACE_MS, "timeout"));
  return Promise.race([network, timer]).then(
    (winner) =>
      winner === "timeout"
        ? new Response(WAKING_PAGE, {
            headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
          })
        : winner,
    // Network error before the timer (e.g. offline): let the browser show its own error.
    () => fetch(request),
  );
}

const WAKING_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BiteBuddy · Warming up</title>
<style>
  :root {
    --bg: hsl(40 14% 98%); --fg: hsl(25 25% 15%); --muted: hsl(25 10% 40%);
    --accent: hsl(18 78% 47%); --line: hsl(25 25% 15%);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: hsl(25 10% 9%); --fg: hsl(40 14% 95%); --muted: hsl(30 6% 65%);
      --accent: hsl(18 78% 55%); --line: hsl(40 14% 90%);
    }
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    display: grid; place-items: center; padding: 16px;
    background: var(--bg); color: var(--fg);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  main { text-align: center; max-width: 22rem; }
  svg { width: 168px; height: 168px; display: block; margin: 0 auto 8px; }
  .stroke { fill: none; stroke: var(--line); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
  .accent { stroke: var(--accent); }
  .body { fill: var(--bg); }
  .spoon { transform-origin: 80px 104px; animation: stir 1.6s ease-in-out infinite; }
  .steam path { animation: rise 2.4s ease-in-out infinite; opacity: 0; }
  .steam path:nth-child(2) { animation-delay: .8s; }
  .steam path:nth-child(3) { animation-delay: 1.6s; }
  .bubble { animation: bob 1.6s ease-in-out infinite; }
  @keyframes stir { 0%, 100% { transform: rotate(-14deg); } 50% { transform: rotate(14deg); } }
  @keyframes rise {
    0% { opacity: 0; transform: translateY(6px); }
    30% { opacity: .9; }
    100% { opacity: 0; transform: translateY(-12px); }
  }
  @keyframes bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
  @media (prefers-reduced-motion: reduce) {
    .spoon, .steam path, .bubble { animation: none; opacity: 1; }
  }
  h1 { font-family: "Source Serif 4", Georgia, "Times New Roman", serif; font-weight: 600; font-size: 1.6rem; margin: 0 0 6px; }
  p { margin: 0; color: var(--muted); line-height: 1.5; }
  #step { min-height: 1.5em; margin-top: 14px; color: var(--accent); font-weight: 500; }
  button {
    margin-top: 18px; font: inherit; color: var(--bg); background: var(--accent);
    border: 0; border-radius: 999px; padding: 10px 20px; cursor: pointer;
  }
  [hidden] { display: none; }
</style>
</head>
<body>
<main role="status" aria-live="polite">
  <svg viewBox="0 0 160 160" aria-hidden="true">
    <g class="steam stroke accent">
      <path d="M58 44c-6-7 6-11 0-18"/>
      <path d="M80 40c-6-7 6-11 0-18"/>
      <path d="M102 44c-6-7 6-11 0-18"/>
    </g>
    <g class="spoon stroke">
      <path d="M80 104 L106 34"/>
      <path d="M104 39 L108.5 27" style="stroke-width:6"/>
    </g>
    <g class="stroke">
      <path class="body" d="M36 74v44a16 16 0 0 0 16 16h56a16 16 0 0 0 16-16V74"/>
      <path d="M30 74h100"/>
      <path d="M36 84H24a6 6 0 0 1 0-12"/>
      <path d="M124 84h12a6 6 0 0 0 0-12"/>
      <path class="accent" d="M44 92c8 4 16 4 24 0s16-4 24 0 16 4 24 0"/>
      <circle class="bubble accent" cx="62" cy="104" r="2.5"/>
      <circle class="bubble accent" cx="94" cy="110" r="2" style="animation-delay:.5s"/>
      <path d="M48 146h64"/>
    </g>
  </svg>
  <h1>The chef is on the way…</h1>
  <p>BiteBuddy was having a nap. It takes about 20 seconds to fire up the kitchen.</p>
  <p id="step">Tying the apron…</p>
  <div id="slow" hidden>
    <p style="margin-top:14px">This is taking longer than usual.</p>
    <button type="button" onclick="location.reload()">Try again</button>
  </div>
</main>
<script>
  var steps = ["Tying the apron…", "Sharpening the knives…", "Preheating the oven…",
               "Chopping the onions…", "Tasting the sauce…", "Plating up…"];
  var i = 0, started = Date.now(), stepEl = document.getElementById("step");
  setInterval(function () { i = Math.min(i + 1, steps.length - 1); stepEl.textContent = steps[i]; }, 3500);
  (function ping() {
    fetch("${PING_PATH}?wake=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (r.ok) { stepEl.textContent = "Dinner is served!"; location.reload(); } else throw 0; })
      .catch(function () {
        if (Date.now() - started > 90000) document.getElementById("slow").hidden = false;
        setTimeout(ping, 1500);
      });
  })();
</script>
</body>
</html>`;
