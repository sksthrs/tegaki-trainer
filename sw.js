const cacheName = 'TegakiTrainer-v0.2.0'
const cacheUrls = [
  './',
  'index.html',
  'index.js',
  'main.css',
  'favicon.ico',
  'icon-192x192.png',
  'icon-512x512.png',
  'apple-touch-icon.png'
]

self.addEventListener('install', (ev) => {
  console.log('[Service Worker] installing...')
  ev.waitUntil((async () => {
    const cache = await caches.open(cacheName)
    console.log('[Service Worker] caching...')
    await cache.addAll(cacheUrls)
  })())
})

self.addEventListener('fetch', (ev) => {
  // network first, cache second
  ev.respondWith((async () => {
    try
    {
      const response = await fetch(ev.request)
      const cache = await caches.open(cacheName)
      cache.put(ev.request, response.clone())
      console.log(`fetched : ${ev.request.url}`)
      return response
    }
    catch (error)
    {
      const r = await caches.match(ev.request)
      if (r) {
        console.log(`found in cache : ${ev.request.url}`)
        return r
      } else {
        console.log(`not available : ${ev.request.url}`)
      }
    }
  })())
})
