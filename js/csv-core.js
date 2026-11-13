/* =========================================================
   CSV整形ツール - csv-core.js
   CSVの読み書きと整形処理（画面に依存しない部分）。
   外部ライブラリなし。ブラウザと Node.js（テスト用）の両方で動く。
   ========================================================= */
(function (root) {
  'use strict';

  /* ----- CSVを2次元配列に変換（ダブルクォート・改行入りセル対応） ----- */
  function parseCsv(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOMを外す
    var rows = [];
    var row = [];
    var cell = '';
    var inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; }
          else { inQuotes = false; }
        } else {
          cell += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(cell); cell = '';
      } else if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else {
        cell += ch;
      }
    }
    if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
    // 空行（セルが1つで空）を除く
    rows = rows.filter(function (r) { return !(r.length === 1 && r[0] === ''); });
    // 列数をそろえる
    var width = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    rows.forEach(function (r) { while (r.length < width) r.push(''); });
    return rows;
  }

  /* ----- 2次元配列をCSV文字列に変換（Excel向けに CRLF） ----- */
  function toCsv(rows) {
    return rows.map(function (r) {
      return r.map(function (v) {
        v = v == null ? '' : String(v);
        return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(',');
    }).join('\r\n') + '\r\n';
  }

  /* ----- 全角英数字・記号を半角に／半角カナを全角に ----- */
  function toHalfwidthAlnum(s) {
    return s
      .replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/　/g, ' ');
  }
  function toFullwidthKana(s) {
    // 半角カナ（濁点・半濁点つき含む）だけを NFKC で全角にする
    return s.replace(/[｡-ﾟ]+/g, function (m) { return m.normalize('NFKC'); });
  }
  function cleanSpaces(s) {
    return s.replace(/[ \t]+/g, ' ').trim();
  }

  /* ----- 日付の読み取り → {y, m, d}。読めなければ null ----- */
  var ERA = { '令和': 2018, 'R': 2018, '平成': 1988, 'H': 1988, '昭和': 1925, 'S': 1925 };

  function validDate(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    var dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return { y: y, m: m, d: d };
  }

  function parseDate(value) {
    var s = toHalfwidthAlnum(String(value)).trim();
    if (!s) return null;
    var m;
    // 2026/1/5, 2026-01-05, 2026.1.5, 2026年1月5日（後ろに時刻があっても日付だけ使う）
    m = s.match(/^(\d{4})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})\s*日?(?:[\sT].*)?$/);
    if (m) return validDate(+m[1], +m[2], +m[3]);
    // 和暦: 令和8年1月5日, R8.1.5, H31/4/30（元年にも対応）
    m = s.match(/^(令和|平成|昭和|[RHS])\s*(\d{1,2}|元)\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})\s*日?$/i);
    if (m) {
      var era = ERA[m[1].toUpperCase()] || ERA[m[1]];
      var n = m[2] === '元' ? 1 : +m[2];
      return validDate(era + n, +m[3], +m[4]);
    }
    // 20260105
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return validDate(+m[1], +m[2], +m[3]);
    return null;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function formatDate(p, format) {
    var sep = format === 'yyyy-MM-dd' ? '-' : '/';
    if (format === 'yyyy年M月d日') return p.y + '年' + p.m + '月' + p.d + '日';
    return p.y + sep + pad2(p.m) + sep + pad2(p.d);
  }

  /* ----- 日付らしい列を推定（空欄以外の8割以上が日付として読める列） ----- */
  function guessDateColumns(rows) {
    if (rows.length < 2) return [];
    var result = [];
    for (var c = 0; c < rows[0].length; c++) {
      var filled = 0, ok = 0;
      for (var r = 1; r < rows.length; r++) {
        var v = (rows[r][c] || '').trim();
        if (!v) continue;
        filled++;
        if (parseDate(v)) ok++;
      }
      if (filled > 0 && ok / filled >= 0.8) result.push(c);
    }
    return result;
  }

  /* ----- 整形のメイン処理 -----
     rows: 1行目が見出しの2次元配列
     opt: {
       columns: 出力する列の番号（並び順どおり）,
       halfwidth: 英数字・記号を半角に, fullKana: 半角カナを全角に, trim: 余分な空白を削除,
       dateColumns: 日付として整える列の番号, dateFormat: 'yyyy/MM/dd' など,
       dedupe: 'none' | 'row' | 'keys', dedupeKeys: 重複判定に使う列の番号
     }
     戻り値: { rows, stats: { inputRows, outputRows, duplicates, changedCells, dateErrors } } */
  function transform(rows, opt) {
    var header = rows[0] || [];
    var body = rows.slice(1);
    var stats = { inputRows: body.length, outputRows: 0, duplicates: 0, changedCells: 0, dateErrors: [] };
    var dateCols = {};
    (opt.dateColumns || []).forEach(function (c) { dateCols[c] = true; });

    var cleaned = body.map(function (row, i) {
      return row.map(function (v, c) {
        var before = v == null ? '' : String(v);
        var after = before;
        if (opt.halfwidth) after = toHalfwidthAlnum(after);
        if (opt.fullKana) after = toFullwidthKana(after);
        if (opt.trim) after = cleanSpaces(after);
        if (dateCols[c] && after !== '') {
          var p = parseDate(after);
          if (p) after = formatDate(p, opt.dateFormat || 'yyyy/MM/dd');
          else stats.dateErrors.push({ row: i + 2, column: header[c] || ('列' + (c + 1)), value: before });
        }
        if (after !== before) stats.changedCells++;
        return after;
      });
    });

    // 重複削除（整形後の値で比較。最初に出てきた行を残す）
    if (opt.dedupe && opt.dedupe !== 'none') {
      var seen = {};
      var keys = opt.dedupe === 'keys' && opt.dedupeKeys && opt.dedupeKeys.length ? opt.dedupeKeys : null;
      cleaned = cleaned.filter(function (row) {
        var k = keys ? keys.map(function (c) { return row[c]; }).join('\u0001') : row.join('\u0001');
        if (keys && keys.every(function (c) { return row[c] === ''; })) return true; // キーが空の行は残す
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

  /* ----- 文字コードの判定（UTF-8として読めなければ Shift_JIS） ----- */
  function decodeBytes(buffer) {
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'UTF-8' };
    } catch (e) {
      return { text: new TextDecoder('shift_jis').decode(buffer), encoding: 'Shift_JIS' };
    }
  }

  var api = {
    parseCsv: parseCsv, toCsv: toCsv, toHalfwidthAlnum: toHalfwidthAlnum, toFullwidthKana: toFullwidthKana,
    cleanSpaces: cleanSpaces, parseDate: parseDate, formatDate: formatDate,
    guessDateColumns: guessDateColumns, transform: transform, decodeBytes: decodeBytes
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CsvCore = api;
})(this);
