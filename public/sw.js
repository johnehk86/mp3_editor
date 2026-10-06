// 오디오 편집기 서비스 워커 — 한 번 열면 오프라인에서도 앱이 열리도록 앱 파일을 캐시한다.
// 편집하는 오디오 파일은 브라우저 안에서만 다루므로 여기서 캐시하지 않는다.
// 캐시 구조를 바꾸면 버전을 올릴 것 (이전 캐시는 activate 때 삭제됨)
const VERSION = 'v1'
const APP_CACHE = `app-${VERSION}`

const PRECACHE = [
  './',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon.svg',
]

self.addEventListener('install', (event) => {
  // 하나씩 저장: 파일 하나가 실패해도 설치 전체가 취소되지 않게
  event.waitUntil(
    caches.open(APP_CACHE).then((c) =>
      Promise.allSettled(
        PRECACHE.map((path) => fetch(path, { cache: 'reload' }).then((res) => res.ok && c.put(path, res)))
      )
    )
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== APP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

function put(request, response) {
  if (response && response.ok) {
    const clone = response.clone()
    caches.open(APP_CACHE).then((c) => c.put(request, clone))
  }
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // 1) 페이지 이동: 네트워크 우선 → 오프라인이면 캐시된 앱 셸
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => put('./', res))
        .catch(() => caches.match('./'))
    )
    return
  }

  // 2) 해시가 붙은 빌드 파일(assets/*)과 아이콘: 캐시 우선
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((res) => put(request, res))))
})
