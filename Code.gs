/**
 * クーポンさがし ― GAS バックエンド
 *
 * できること（GitHub Pages の画面から ?q=店名 で呼ばれる）
 *   1. Google ニュース RSS で「店名 クーポン」の直近30日の記事を取得（キー不要）
 *   2. ホットペッパーグルメ API でクーポンページ付きの店舗を取得（無料キーを入れたときだけ）
 *
 * 設定
 *   プロジェクトの設定 → スクリプト プロパティ に
 *     HOTPEPPER_KEY = （リクルートWEBサービスで発行したキー） ※任意
 *
 * デプロイ
 *   デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *     次のユーザーとして実行：自分 / アクセスできるユーザー：全員
 *   → 出てきた .../exec の URL を index.html の GAS_URL に貼る
 *   ※コードを直したら「デプロイを管理 → 編集 → バージョン：新バージョン」で更新しないと反映されません
 */

const CACHE_SECONDS = 30 * 60; // 同じ検索語は30分キャッシュ

function doGet(e) {
  const q = String((e && e.parameter && e.parameter.q) || '').trim().slice(0, 50);
  if (!q) return json_({ error: 'q is required' });

  const cache = CacheService.getScriptCache();
  const key = 'v1:' + Utilities.base64EncodeWebSafe(q);
  const hit = cache.get(key);
  if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);

  // 取得に失敗した項目は news: null（0件の [] と区別する）。失敗を含む結果はキャッシュしない
  let failed = false;
  const out = {
    q: q,
    news: safe_(() => getNews_(q), null, () => { failed = true; }),
    hotpepper: safe_(() => getHotpepper_(q), null, () => { failed = true; }),
    fetchedAt: new Date().toISOString(),
  };
  const body = JSON.stringify(out);
  if (!failed) {
    try { cache.put(key, body, CACHE_SECONDS); } catch (_) { /* 100KB超などは無視 */ }
  }
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

/** Google ニュース RSS：「店名 クーポン」直近30日 */
function getNews_(q) {
  const query = q + ' クーポン when:30d';
  const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(query) + '&hl=ja&gl=JP&ceid=JP:ja';
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('news http ' + res.getResponseCode());

  const channel = XmlService.parse(res.getContentText()).getRootElement().getChild('channel');
  return channel.getChildren('item').slice(0, 20).map(function (it) {
    return {
      title: it.getChildText('title'),
      link: it.getChildText('link'),
      date: it.getChildText('pubDate'),
      source: it.getChildText('source'),
    };
  });
}

/** ホットペッパーグルメ API：キーワードで店舗検索してクーポンURLを返す */
function getHotpepper_(q) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('HOTPEPPER_KEY');
  if (!apiKey) return null;

  const url = 'https://webservice.recruit.co.jp/hotpepper/gourmet/v1/'
    + '?key=' + encodeURIComponent(apiKey)
    + '&keyword=' + encodeURIComponent(q)
    + '&count=20&format=json';
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('hotpepper http ' + res.getResponseCode());

  const results = JSON.parse(res.getContentText()).results || {};
  if (results.error) throw new Error('hotpepper api error ' + JSON.stringify(results.error));
  const shops = results.shop || [];
  return shops.map(function (s) {
    return {
      name: s.name,
      genre: s.genre && s.genre.name,
      access: s.mobile_access || s.access,
      address: s.address,
      url: s.urls && s.urls.pc,
      couponUrl: s.coupon_urls && (s.coupon_urls.sp || s.coupon_urls.pc),
      photo: s.photo && s.photo.mobile && s.photo.mobile.s,
    };
  });
}

function safe_(fn, fallback, onError) {
  try { return fn(); } catch (err) {
    // 例外メッセージにURL（= APIキー）が含まれることがあるので、ログには伏せて出す
    console.error(String(err && err.message || err).replace(/([?&]key=)[^&\s]+/g, '$1***'));
    if (onError) onError();
    return fallback;
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** エディタから実行して動作確認用 */
function test() {
  const r = doGet({ parameter: { q: 'マクドナルド' } });
  console.log(r.getContent().slice(0, 1500));
}
