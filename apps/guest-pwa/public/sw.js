// Keeps the app itself available on bad connections. API responses are never cached:
// a bill must always be current, and the API lives on another origin anyway.

const CACHE = "tabtap-app-v1";
const SHELL = "/index.html";
const STATIC_PATH = /^\/(assets|icons)\//;

/** Stores the page and the files it links to, which loaded before this worker existed. */
async function cacheShell(cache, response) {
  await cache.put(SHELL, response.clone());
  const html = await response.text();
  const linked = [...html.matchAll(/(?:href|src)="(\/(?:assets|icons)\/[^"]+)"/g)].map((match) => match[1]);
  for (const url of linked) if (!(await cache.match(url))) await cache.add(url);
  // Built files have hashed names, so anything no longer linked belongs to an old version.
  for (const request of await cache.keys()) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/assets/") && !linked.includes(pathname)) await cache.delete(request);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const response = await fetch(SHELL, { cache: "no-cache" });
      if (response.ok) await cacheShell(await caches.open(CACHE), response);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

/** Newest page when the network answers, the saved one when it doesn't. */
async function handleNavigation(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cacheShell(cache, response.clone()).catch(() => undefined);
    return response;
  } catch {
    return (await cache.match(SHELL)) ?? Response.error();
  }
}

/** Hashed files never change, so a saved copy is always right. */
async function handleStatic(request) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") event.respondWith(handleNavigation(request));
  else if (STATIC_PATH.test(url.pathname)) event.respondWith(handleStatic(request));
});
