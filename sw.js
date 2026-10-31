// Service Worker のひな形（設計書 6.8.3 節）。
//
// このファイルは Vite の対象外（そのままコピーされる）で、tsc の対象外でもあります。ES2020 までの素の JavaScript で書きます。
// ビルドの最後に scripts/finalize-dist.ts が、下の BUILD_VERSION と PRECACHE の「値」を置き換えて dist/sw.js を作ります。
//   BUILD_VERSION … ビルドごとの版（プリキャッシュするファイルの内容から決まる 12 桁）
//   PRECACHE      … プリキャッシュするファイルの一覧（サイトのルートからの相対パスの配列）
// 置き換えの目印になる文字列は、この下の 2 行にしか書かないこと（コメントにも書かない）。

const BUILD_VERSION = 'd7f4758e426b';
const PRECACHE = ["assets/KaTeX_AMS-Regular-BQhdFMY1.woff2","assets/KaTeX_Caligraphic-Bold-Dq_IR9rO.woff2","assets/KaTeX_Caligraphic-Regular-Di6jR-x-.woff2","assets/KaTeX_Fraktur-Bold-CL6g_b3V.woff2","assets/KaTeX_Fraktur-Regular-CTYiF6lA.woff2","assets/KaTeX_Main-Bold-Cx986IdX.woff2","assets/KaTeX_Main-BoldItalic-DxDJ3AOS.woff2","assets/KaTeX_Main-Italic-NWA7e6Wa.woff2","assets/KaTeX_Main-Regular-B22Nviop.woff2","assets/KaTeX_Math-BoldItalic-CZnvNsCZ.woff2","assets/KaTeX_Math-Italic-t53AETM-.woff2","assets/KaTeX_SansSerif-Bold-D1sUS0GD.woff2","assets/KaTeX_SansSerif-Italic-C3H0VqGB.woff2","assets/KaTeX_SansSerif-Regular-DDBCnlJ7.woff2","assets/KaTeX_Script-Regular-D3wIWfF6.woff2","assets/KaTeX_Size1-Regular-mCD8mA8B.woff2","assets/KaTeX_Size2-Regular-Dy4dx90m.woff2","assets/KaTeX_Size4-Regular-Dl5lxZxV.woff2","assets/KaTeX_Typewriter-Regular-CO6r4hn1.woff2","assets/index-0vJSqQPB.js","assets/index-CVv3hci6.css","assets/pdf-BpKDAv4t.js","assets/pdf.worker.min-Dkey6ZUl.mjs","assets/qrcode-rB7AVKgv.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];

// src/shared/namespace.ts の namespaceFromPath と同じ内容（変更するときは両方そろえること）
function namespaceFromPath(pathname) { return 'study' + pathname.replace(/[^A-Za-z0-9]/g, '_'); }

const SCOPE = new URL(self.registration.scope);
const NS = namespaceFromPath(SCOPE.pathname);
const SHELL = `${NS}-shell-${BUILD_VERSION}`;
const CONTENT = `${NS}-content-v1`;
const RUNTIME = `${NS}-runtime-v1`;

// install: アプリの器をすべて保存する。skipWaiting() は呼ばない（更新はユーザーが［更新する］を押したときに適用する）
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // cache: 'no-cache' で、ブラウザや CDN の古いキャッシュではなく、サーバーの最新の内容を保存する
    await cache.addAll(PRECACHE.map((p) => new Request(new URL(p, SCOPE).href, { cache: 'no-cache' })));
  })());
});

// activate: 古い版のアプリの器を削除して、開いているページの制御を始める
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith(`${NS}-shell-`) && k !== SHELL)
        .map((k) => caches.delete(k)),
    );
    await self.clients.claim();
  })());
});

// message: アプリから SKIP_WAITING が届いたら、待機中の新しい版をすぐ有効にする
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// キャッシュ優先: あれば返し、無ければネットワークから取得して（成功したら）保存する
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request.url);
  if (hit) return hit;
  const res = await fetch(request);
  // 保存できるのは「同じオリジンの 200 の応答」だけ（206 などは保存できない）
  if (res.ok && res.status === 200 && res.type === 'basic') {
    try {
      await cache.put(request.url, res.clone());
    } catch (e) {
      // 容量不足などで保存できなくても、応答は返す
    }
  }
  return res;
}

// アプリの器のファイル: 保存済みならそれを返し、無ければネットワーク
async function shellFirst(request, matchUrl) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(matchUrl || request.url, { ignoreSearch: true });
  return hit || fetch(request);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // GET 以外、別オリジン、スコープ配下でないものは何もしない
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== SCOPE.origin) return;
  if (!url.pathname.startsWith(SCOPE.pathname)) return;

  const rel = url.pathname.slice(SCOPE.pathname.length);

  // ページの表示（アドレスを開いた・再読み込み）: 保存済みの index.html を返す（オフラインでも起動できる）
  if (request.mode === 'navigate' && (rel === '' || rel === 'index.html')) {
    event.respondWith(shellFirst(request, new URL('index.html', SCOPE).href));
    return;
  }
  // 画像・PDF などの教材の素材（ファイル名が内容のハッシュなので、保存したものはずっと正しい）
  if (rel.startsWith('content/a/')) {
    event.respondWith(cacheFirst(request, CONTENT));
    return;
  }
  // pdf.js の補助ファイル
  if (rel.startsWith('pdfjs/')) {
    event.respondWith(cacheFirst(request, RUNTIME));
    return;
  }
  // 教材のインデックスと本体（index.json、m/）は、アプリ側（contentClient）が扱う
  if (rel.startsWith('content/')) return;

  // その他: アプリの器のファイル
  event.respondWith(shellFirst(request));
});
