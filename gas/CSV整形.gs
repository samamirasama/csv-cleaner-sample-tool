/**
 * CSV整形（Google スプレッドシート用 / Google Apps Script）
 * ポートフォリオ用サンプル。ブラウザ版（index.html）と同じ整形を、スプレッドシート上で行う。
 *
 * できること（下の CONFIG で切り替え）
 *   - 出力する列と並び順の指定（見出し名で指定）
 *   - 英数字・記号を半角に／半角カナを全角に／余分な空白の整理
 *   - 日付の形式をそろえる（2026/1/5・2026-01-05・2026年1月5日・令和8年1月5日・R8.1.5・20260105 を読み取る）
 *   - 重複した行の削除（全列一致、または指定した列が一致）
 *
 * 元のシートは書き換えず、「整形結果」シートに出力する。外部への送信はしない。
 */

/* ===== 設定（ここを書き換えて使う） ===== */
var CONFIG = {
  // 出力する列と並び順（見出し名）。空の配列 [] なら全列をそのままの順で出力
  columns: [],
  // 文字の統一
  halfwidth: true,   // 英数字・記号を半角に（１２３ → 123）
  fullKana: true,    // 半角カナを全角に（ｶﾅ → カナ）
  trim: true,        // 前後の空白と連続した空白を整理
  // 日付としてそろえる列（見出し名）。空の配列 [] なら自動で判定
  dateColumns: [],
  dateFormat: 'yyyy/MM/dd', // 'yyyy/MM/dd' / 'yyyy-MM-dd' / 'yyyy年M月d日'
  // 重複削除: 'none'（しない） / 'row'（全列一致） / 'keys'（dedupeKeys の列が一致）
  dedupe: 'row',
  dedupeKeys: [],    // 例: ['会員番号']
  // 出力シート名
  outputSheetName: '整形結果',
  // true にすると、出力をすべて文字列として書き込む（先頭の0や「000-0000-0001」が数値や日付に変わらない）
  keepAsText: true
};

/* ===== メニュー ===== */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('CSV整形')
    .addItem('いまのシートを整形する', 'formatActiveSheet')
    .addToUi();
}

/* ===== メイン ===== */
function formatActiveSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  if (sheet.getName() === CONFIG.outputSheetName) {
    SpreadsheetApp.getUi().alert('整形したいデータのシートを開いてから実行してください。');
    return;
  }
  var range = sheet.getDataRange();
  // 画面に表示されている文字のまま取得する（日付や先頭の0が変わらないように）
  var rows = range.getDisplayValues();
  if (rows.length < 2) {
    SpreadsheetApp.getUi().alert('データの行が見つかりません。1行目が見出し、2行目以降がデータの表で実行してください。');
    return;
  }

  var header = rows[0];
  var opt = {
    columns: namesToIndexes_(header, CONFIG.columns),
    halfwidth: CONFIG.halfwidth,
    fullKana: CONFIG.fullKana,
    trim: CONFIG.trim,
    dateColumns: CONFIG.dateColumns.length ? namesToIndexes_(header, CONFIG.dateColumns) : guessDateColumns_(rows),
    dateFormat: CONFIG.dateFormat,
    dedupe: CONFIG.dedupe,
    dedupeKeys: namesToIndexes_(header, CONFIG.dedupeKeys)
  };
  var result = transform_(rows, opt);

  var out = ss.getSheetByName(CONFIG.outputSheetName) || ss.insertSheet(CONFIG.outputSheetName);
  out.clear();
  var target = out.getRange(1, 1, result.rows.length, result.rows[0].length);
  if (CONFIG.keepAsText) target.setNumberFormat('@');
  target.setValues(result.rows);
  out.getRange(1, 1, 1, result.rows[0].length).setFontWeight('bold').setBackground('#e6f4ef');
  out.setFrozenRows(1);
  out.autoResizeColumns(1, result.rows[0].length);

  var s = result.stats;
  var msg = '整形が終わりました（「' + CONFIG.outputSheetName + '」シート）\n\n' +
    '読み込んだ行: ' + s.inputRows + '行\n' +
    '出力した行: ' + s.outputRows + '行\n' +
    '削除した重複: ' + s.duplicates + '行\n' +
    '書き換えたセル: ' + s.changedCells + '件';
  if (s.dateErrors.length) {
    msg += '\n\n日付として読み取れなかった値（元の値のまま）: ' + s.dateErrors.length + '件\n' +
      s.dateErrors.slice(0, 5).map(function (e) { return '・' + e.row + '行目「' + e.column + '」: ' + e.value; }).join('\n');
  }
  SpreadsheetApp.getUi().alert(msg);
}

/* ===== 見出し名 → 列番号 ===== */
function namesToIndexes_(header, names) {
  var result = [];
  (names || []).forEach(function (name) {
    var i = header.indexOf(name);
    if (i === -1) throw new Error('見出し「' + name + '」が見つかりません。CONFIG の列名を確認してください。');
    result.push(i);
  });
  return result;
}

/* ===== 以下、整形の処理（ブラウザ版 js/csv-core.js と同じ内容） ===== */
function toHalfwidthAlnum_(s) {
  return s
    .replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/　/g, ' ');
}

function toFullwidthKana_(s) {
  return s.replace(/[｡-ﾟ]+/g, function (m) { return m.normalize('NFKC'); });
}

function cleanSpaces_(s) {
  return s.replace(/[ \t]+/g, ' ').trim();
}

var ERA_ = { '令和': 2018, 'R': 2018, '平成': 1988, 'H': 1988, '昭和': 1925, 'S': 1925 };

function validDate_(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  var dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return { y: y, m: m, d: d };
}

function parseDate_(value) {
  var s = toHalfwidthAlnum_(String(value)).trim();
  if (!s) return null;
  var m = s.match(/^(\d{4})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})\s*日?(?:[\sT].*)?$/);
  if (m) return validDate_(+m[1], +m[2], +m[3]);
  m = s.match(/^(令和|平成|昭和|[RHS])\s*(\d{1,2}|元)\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})\s*日?$/i);
  if (m) {
    var era = ERA_[m[1].toUpperCase()] || ERA_[m[1]];
    var n = m[2] === '元' ? 1 : +m[2];
    return validDate_(era + n, +m[3], +m[4]);
  }
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return validDate_(+m[1], +m[2], +m[3]);
  return null;
}

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

function formatDate_(p, format) {
  if (format === 'yyyy年M月d日') return p.y + '年' + p.m + '月' + p.d + '日';
  var sep = format === 'yyyy-MM-dd' ? '-' : '/';
  return p.y + sep + pad2_(p.m) + sep + pad2_(p.d);
}

function guessDateColumns_(rows) {
  var result = [];
  for (var c = 0; c < rows[0].length; c++) {
    var filled = 0, ok = 0;
    for (var r = 1; r < rows.length; r++) {
      var v = String(rows[r][c] || '').trim();
      if (!v) continue;
      filled++;
      if (parseDate_(v)) ok++;
    }
    if (filled > 0 && ok / filled >= 0.8) result.push(c);
  }
  return result;
}

function transform_(rows, opt) {
  var header = rows[0];
  var body = rows.slice(1);
  var stats = { inputRows: body.length, outputRows: 0, duplicates: 0, changedCells: 0, dateErrors: [] };
  var dateCols = {};
  (opt.dateColumns || []).forEach(function (c) { dateCols[c] = true; });

  var cleaned = body.map(function (row, i) {
    return row.map(function (v, c) {
      var before = v == null ? '' : String(v);
      var after = before;
      if (opt.halfwidth) after = toHalfwidthAlnum_(after);
      if (opt.fullKana) after = toFullwidthKana_(after);
      if (opt.trim) after = cleanSpaces_(after);
      if (dateCols[c] && after !== '') {
        var p = parseDate_(after);
        if (p) after = formatDate_(p, opt.dateFormat || 'yyyy/MM/dd');
        else stats.dateErrors.push({ row: i + 2, column: header[c] || ('列' + (c + 1)), value: before });
      }
      if (after !== before) stats.changedCells++;
      return after;
    });
  });

  if (opt.dedupe && opt.dedupe !== 'none') {
    var seen = {};
    var keys = opt.dedupe === 'keys' && opt.dedupeKeys && opt.dedupeKeys.length ? opt.dedupeKeys : null;
    cleaned = cleaned.filter(function (row) {
      if (keys && keys.every(function (c) { return row[c] === ''; })) return true;
      var k = keys ? keys.map(function (c) { return row[c]; }).join('\u0001') : row.join('\u0001');
      if (seen[k]) { stats.duplicates++; return false; }
      seen[k] = true;
      return true;
    });
  }

  var cols = opt.columns && opt.columns.length ? opt.columns : header.map(function (_, i) { return i; });
  var out = [cols.map(function (c) { return header[c]; })].concat(cleaned.map(function (row) {
    return cols.map(function (c) { return row[c]; });
  }));
  stats.outputRows = out.length - 1;
  return { rows: out, stats: stats };
}
