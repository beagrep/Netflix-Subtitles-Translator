/**
 * Netflix Subtitles Translator - Database Module
 * SQLite-based translation and subtitle caching.
 */
(function(NST) {
  'use strict';

  // Use LOG/WARN from utils if available, otherwise define local
  const LOG = NST.utils ? NST.utils.LOG : function() { try { console.log.apply(console, ['[NST]'].concat([].slice.call(arguments))); } catch(e){} };
  const WARN = NST.utils ? NST.utils.WARN : function() { try { console.warn.apply(console, ['[NST]'].concat([].slice.call(arguments))); } catch(e){} };

  const NST_DB_KEY = 'nstSqliteDump:v1';
  const NST_DB_LEGACY_PREFIX = 'nstTr:v1:';

  // Module state
  let SQL = null;
  let db = null;
  let ready = false;
  let openWaiters = [];
  let saveTimer = null;

  /**
   * Load database dump from chrome.storage.local
   */
  function loadDump() {
    return new Promise(function(resolve) {
      try {
        chrome.storage.local.get(NST_DB_KEY, function(items) {
          const v = items && items[NST_DB_KEY];
          if (v && v.bytes && Array.isArray(v.bytes)) {
            LOG('nstDB loading existing dump, bytes:', v.bytes.length);
            resolve(new Uint8Array(v.bytes));
          } else {
            resolve(null);
          }
        });
      } catch(e) { resolve(null); }
    });
  }

  /**
   * Create database schema if it doesn't exist
   */
  function createSchema() {
    db.run([
      'CREATE TABLE IF NOT EXISTS videos (',
      '  video_id TEXT PRIMARY KEY,',
      '  url TEXT NOT NULL,',
      '  title TEXT,',
      '  src_lang TEXT NOT NULL,',
      '  tgt_lang TEXT NOT NULL,',
      '  first_seen INTEGER NOT NULL,',
      '  last_seen INTEGER NOT NULL',
      ');',
      'CREATE TABLE IF NOT EXISTS subtitles (',
      '  video_id TEXT NOT NULL,',
      '  video_time REAL NOT NULL,',
      '  original TEXT NOT NULL,',
      '  translation TEXT,',
      '  status TEXT NOT NULL,',
      '  attempts INTEGER NOT NULL DEFAULT 0,',
      '  last_attempt INTEGER,',
      '  PRIMARY KEY (video_id, video_time, original)',
      ');',
      'CREATE INDEX IF NOT EXISTS idx_subtitles_video ON subtitles(video_id, video_time);',
      'CREATE TABLE IF NOT EXISTS cache_translations (',
      '  src_lang TEXT NOT NULL,',
      '  tgt_lang TEXT NOT NULL,',
      '  original TEXT NOT NULL,',
      '  translation TEXT NOT NULL,',
      '  ts INTEGER NOT NULL,',
      '  PRIMARY KEY (src_lang, tgt_lang, original)',
      ');'
    ].join('\n'));
  }

  /**
   * Migrate legacy cache from chrome.storage.local to SQLite
   */
  function maybeMigrateLegacyCache() {
    try {
      chrome.storage.local.get(null, function(items) {
        if (!items) return;
        const keys = Object.keys(items).filter(function(k) { return k.indexOf(NST_DB_LEGACY_PREFIX) === 0; });
        if (!keys.length) return;
        LOG('nstDB migrating', keys.length, 'legacy cache entries');
        const stmt = db.prepare('INSERT OR IGNORE INTO cache_translations(src_lang,tgt_lang,original,translation,ts) VALUES (?,?,?,?,?)');
        const now = Date.now();
        keys.forEach(function(k) {
          const parts = k.substring(NST_DB_LEGACY_PREFIX.length).split(':');
          if (parts.length < 3) return;
          const src = parts[0], tgt = parts[1];
          const text = parts.slice(2).join(':');
          const v = items[k];
          if (!v || typeof v.t !== 'string') return;
          stmt.run([src, tgt, text, v.t, v.ts || now]);
        });
        stmt.free();
        chrome.storage.local.remove(keys, function() {
          LOG('nstDB migration done; legacy keys removed');
          scheduleSave();
        });
      });
    } catch(e) { WARN('migration failed:', e && e.message); }
  }

  /**
   * Get database stats (row counts)
   */
  function stats() {
    try {
      const r = db.exec('SELECT (SELECT count(*) FROM videos) v, (SELECT count(*) FROM subtitles) s, (SELECT count(*) FROM cache_translations) c');
      if (r && r[0]) return r[0].values[0];
    } catch(e){}
    return null;
  }

  /**
   * Schedule a database save (debounced)
   */
  function scheduleSave() {
    if (!ready) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function() {
      saveTimer = null;
      try {
        const bytes = db.export();
        const obj = {};
        obj[NST_DB_KEY] = { bytes: Array.from(bytes), savedAt: Date.now() };
        chrome.storage.local.set(obj, function() {
          if (chrome.runtime.lastError) WARN('nstDB save error:', chrome.runtime.lastError.message);
          else LOG('nstDB saved, bytes:', bytes.length);
        });
      } catch(e) { WARN('nstDB export failed:', e && e.message); }
    }, 2000);
  }

  /**
   * Register a callback to run when the database is ready
   */
  function whenReady(callback) {
    if (ready) return callback();
    openWaiters.push(callback);
  }

  /**
   * Get a cached translation from the database
   */
  function getCachedTranslation(src, tgt, text, callback) {
    whenReady(function() {
      try {
        const stmt = db.prepare('SELECT translation FROM cache_translations WHERE src_lang=? AND tgt_lang=? AND original=?');
        stmt.bind([src, tgt, text]);
        let result = null;
        if (stmt.step()) result = stmt.getAsObject().translation;
        stmt.free();
        callback(result || null);
      } catch(e) { WARN('getCachedTranslation:', e && e.message); callback(null); }
    });
  }

  /**
   * Store a translation in the cache
   */
  function setCachedTranslation(src, tgt, text, translation) {
    whenReady(function() {
      try {
        const stmt = db.prepare('INSERT OR REPLACE INTO cache_translations(src_lang,tgt_lang,original,translation,ts) VALUES (?,?,?,?,?)');
        stmt.run([src, tgt, text, translation, Date.now()]);
        stmt.free();
        scheduleSave();
      } catch(e) { WARN('setCachedTranslation:', e && e.message); }
    });
  }

  /**
   * Upsert a video record
   */
  function upsertVideo(videoId, url, title, src, tgt) {
    whenReady(function() {
      try {
        const now = Date.now();
        const stmt = db.prepare('INSERT INTO videos(video_id,url,title,src_lang,tgt_lang,first_seen,last_seen) VALUES (?,?,?,?,?,?,?) ON CONFLICT(video_id) DO UPDATE SET url=excluded.url, title=COALESCE(NULLIF(excluded.title,""),videos.title), src_lang=excluded.src_lang, tgt_lang=excluded.tgt_lang, last_seen=excluded.last_seen');
        stmt.run([videoId, url, title || '', src, tgt, now, now]);
        stmt.free();
        scheduleSave();
      } catch(e) { WARN('upsertVideo:', e && e.message); }
    });
  }

  /**
   * Record a subtitle (or update an existing one)
   */
  function recordSubtitle(videoId, videoTime, original, translation, status) {
    whenReady(function() {
      try {
        const now = Date.now();
        const stmt = db.prepare('INSERT INTO subtitles(video_id,video_time,original,translation,status,attempts,last_attempt) VALUES (?,?,?,?,?,?,?) ON CONFLICT(video_id,video_time,original) DO UPDATE SET translation=COALESCE(excluded.translation, subtitles.translation), status=excluded.status, attempts=subtitles.attempts+1, last_attempt=excluded.last_attempt');
        stmt.run([videoId, videoTime, original, translation || null, status, 1, now]);
        stmt.free();
        scheduleSave();
      } catch(e) { WARN('recordSubtitle:', e && e.message); }
    });
  }

  /**
   * Load all subtitles for a video
   */
  function loadVideoSubtitles(videoId, callback) {
    whenReady(function() {
      try {
        const stmt = db.prepare('SELECT video_time, original, translation, status FROM subtitles WHERE video_id=? ORDER BY video_time');
        stmt.bind([videoId]);
        const out = [];
        while (stmt.step()) out.push(stmt.getAsObject());
        stmt.free();
        callback(out);
      } catch(e) { WARN('loadVideoSubtitles:', e && e.message); callback([]); }
    });
  }

  /**
   * Clear all subtitles for a video
   */
  function clearVideoSubtitles(videoId, callback) {
    whenReady(function() {
      try {
        // Delete subtitles for this video
        let stmt = db.prepare('DELETE FROM subtitles WHERE video_id=?');
        stmt.bind([videoId]);
        stmt.step();
        stmt.free();
        // Also delete the video entry
        stmt = db.prepare('DELETE FROM videos WHERE video_id=?');
        stmt.bind([videoId]);
        stmt.step();
        stmt.free();
        scheduleSave();
        LOG('nstDB cleared subtitles for video:', videoId);
        if (callback) callback({ ok: true });
      } catch(e) {
        WARN('clearVideoSubtitles:', e && e.message);
        if (callback) callback({ ok: false, error: e && e.message });
      }
    });
  }

  /**
   * Initialize the database module
   */
  function init() {
    if (typeof initSqlJs !== 'function') {
      WARN('sql.js (initSqlJs) not loaded — DB disabled, falling back to RAM only');
      return;
    }
    initSqlJs({
      locateFile: function(f) { return chrome.runtime.getURL('vendor/sqljs/' + f); }
    }).then(function(SQLLib) {
      SQL = SQLLib;
      return loadDump();
    }).then(function(dump) {
      try {
        db = dump ? new SQL.Database(dump) : new SQL.Database();
      } catch(e) {
        WARN('failed to open dump, starting fresh:', e && e.message);
        db = new SQL.Database();
      }
      createSchema();
      maybeMigrateLegacyCache();
      ready = true;
      LOG('nstDB ready; rows so far:', stats());
      openWaiters.forEach(function(fn) { try { fn(); } catch(e){} });
      openWaiters = [];
    }).catch(function(e) {
      WARN('nstDB init failed:', e && e.message);
    });
  }

  // Export public API
  NST.db = {
    whenReady: whenReady,
    getCachedTranslation: getCachedTranslation,
    setCachedTranslation: setCachedTranslation,
    upsertVideo: upsertVideo,
    recordSubtitle: recordSubtitle,
    loadVideoSubtitles: loadVideoSubtitles,
    clearVideoSubtitles: clearVideoSubtitles,
    scheduleSave: scheduleSave
  };

  // Initialize when DOM is ready (or immediately)
  init();

})(window.NST = window.NST || {});
