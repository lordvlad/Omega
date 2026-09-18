/**
 * omega's service worker.
 *
 * The point is that the app opens and reads correctly with no server: the
 * shell boots from cache, deep links resolve, and the conversations you have
 * already looked at are still there. What it deliberately does not do is
 * pretend the agent is reachable — a prompt needs a process on the other end,
 * and faking that would be worse than saying so.
 *
 * Strategy per request class, because one policy cannot serve all of them:
 *
 *   navigations      network first, cached shell as the fallback. The HTML
 *                    names content-hashed asset URLs, so a stale copy of it
 *                    would point at assets a new build has renamed; the
 *                    network wins whenever it can answer.
 *   hashed assets    cache first. The hash *is* the version, so a hit can
 *                    never be stale, and this is what makes a cold offline
 *                    boot fast rather than merely possible.
 *   /api/workspaces  stale while revalidate, so the workspace and session
 *                    list is browsable offline and refreshes in the
 *                    background when it is not.
 *   everything /api  network only. These are reads of live agent state and
 *                    writes to it; a cached answer would be a lie.
 *
 * Transcripts are pointedly absent. They are already persisted per session in
 * IndexedDB, with their own eviction policy, by `lib/transcript-cache.ts`.
 * Caching the same bytes again here would double the storage for one copy of
 * the truth, and the two would disagree the moment one evicted.
 */

/** Bumping this name is what retires every previously cached response. */
const CACHE = "omega-v1";

/** Cached ahead of time; everything else is learned as it is requested. */
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

/** Shown for a navigation when there is no network and no cached shell yet. */
const FALLBACK = `<!doctype html>
<html lang="en" data-mantine-color-scheme="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>omega — offline</title>
    <style>
      html, body { height: 100%; margin: 0; }
      body {
        display: grid; place-items: center;
        background: #191527; color: #e7d6fb;
        font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
        text-align: center; padding: 24px;
      }
      p { color: #9a90b4; max-width: 34rem; }
      code { color: #5de4f7; }
    </style>
  </head>
  <body>
    <div>
      <h1>omega is offline</h1>
      <p>
        This device cannot reach the omega server, and no copy of the app has
        been stored yet. Open omega once while the server is running, and it
        will load from here on out.
      </p>
      <p><code>bun start</code></p>
    </div>
  </body>
</html>`;

self.addEventListener("install", event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Individually, so one failure cannot abort the whole install and leave
      // the worker permanently un-installed.
      await Promise.all(
        SHELL.map(url => cache.add(new Request(url, { cache: "reload" })).catch(() => undefined)),
      );
      // Take over promptly: a tool you leave open would otherwise keep the
      // previous worker until every tab is closed, which is close to never.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter(name => name !== CACHE).map(name => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

/** Cache a response only if it is one worth replaying. */
function cacheable(response) {
  return response && response.status === 200 && response.type === "basic";
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request);
    // Keep the shell under "/" rather than the deep link that fetched it, so
    // every route falls back to one entry instead of only the ones visited.
    if (cacheable(fresh)) await cache.put("/", fresh.clone());
    return fresh;
  } catch {
    const cached = (await cache.match("/")) ?? (await cache.match(request));
    return (
      cached ??
      new Response(FALLBACK, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    );
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const fresh = await fetch(request);
  if (cacheable(fresh)) await cache.put(request, fresh.clone());
  return fresh;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  const update = fetch(request)
    .then(fresh => {
      if (cacheable(fresh)) void cache.put(request, fresh.clone());
      return fresh;
    })
    .catch(() => undefined);
  // A hit serves immediately and the refresh lands in the background; a miss
  // has to wait for the network, and reports its failure honestly.
  if (hit) {
    void update;
    return hit;
  }
  const fresh = await update;
  return (
    fresh ??
    new Response(JSON.stringify({ status: 503, detail: "Offline and not cached." }), {
      status: 503,
      headers: { "content-type": "application/json" },
    })
  );
}

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Bun's dev client streams reloads over this; caching it would fight HMR.
  if (url.pathname.startsWith("/_bun/hmr")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (url.pathname === "/api/workspaces") {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Live agent state and every mutation: never answered from a cache.
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(cacheFirst(request));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    }),
  );
});
