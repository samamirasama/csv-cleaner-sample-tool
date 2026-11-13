/* =========================================================
   CSV整形ツール - main.js（画面の操作。外部ライブラリなし・外部送信なし）
   ========================================================= */
(function () {
  'use strict';

  var Core = window.CsvCore;
  var PREVIEW_ROWS = 20;

  var state = {
    rows: null,        // 読み込んだCSV（1行目が見出し）
    order: [],         // 列の並び順 [{index, on}]
    dateColumns: [],   // 日付として整える列
    dedupeKeys: [],    // 重複判定に使う列
    fileName: '',
    result: null
  };

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    file: $('file-input'), drop: $('dropzone'), loadStatus: $('load-status'),
    options: $('options'), result: $('result'), columnList: $('column-list'),
    dateColumns: $('date-columns'), dedupeKeys: $('dedupe-keys'),
    halfwidth: $('opt-halfwidth'), fullKana: $('opt-fullkana'), trim: $('opt-trim'),
    dateFormat: $('opt-dateformat'), stats: $('stats'), dateErrors: $('date-errors'),
    preview: $('preview'), previewNote: $('preview-note'), fileNameInput: $('file-name'),
    download: $('download')
  };

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }

  function header() { return state.rows[0]; }
  function colName(i) { return header()[i] || ('列' + (i + 1)); }

  /* ----- 読み込み ----- */
  function loadText(text, name, encoding) {
    var rows = Core.parseCsv(text);
    if (rows.length < 2) {
      showLoadStatus('データの行が見つかりませんでした。1行目が見出し、2行目以降がデータのCSVを選んでください。', true);
      return;
    }
    state.rows = rows;
    state.fileName = name;
    state.order = rows[0].map(function (_, i) { return { index: i, on: true }; });
    state.dateColumns = Core.guessDateColumns(rows);
    state.dedupeKeys = [0];
    els.fileNameInput.value = name.replace(/\.csv$/i, '') + '_整形済み.csv';
    showLoadStatus('「' + name + '」を読み込みました（' + (encoding ? encoding + '・' : '') +
      (rows.length - 1) + '行 × ' + rows[0].length + '列）。', false);
    els.options.hidden = false;
    els.result.hidden = false;
    renderOptions();
    run();
  }

  function showLoadStatus(msg, isError) {
    els.loadStatus.textContent = msg;
    els.loadStatus.classList.toggle('status--error', !!isError);
  }

  function readFile(file) {
    if (!file) return;
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
      showLoadStatus('CSVファイル（.csv）を選んでください。', true);
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var decoded = Core.decodeBytes(new Uint8Array(reader.result));
      loadText(decoded.text, file.name, decoded.encoding);
    };
    reader.onerror = function () { showLoadStatus('ファイルを読み込めませんでした。', true); };
    reader.readAsArrayBuffer(file);
  }

  els.file.addEventListener('change', function () { readFile(els.file.files[0]); els.file.value = ''; });

  ['dragenter', 'dragover'].forEach(function (type) {
    els.drop.addEventListener(type, function (e) { e.preventDefault(); els.drop.classList.add('is-dragover'); });
  });
  ['dragleave', 'drop'].forEach(function (type) {
    els.drop.addEventListener(type, function (e) { e.preventDefault(); els.drop.classList.remove('is-dragover'); });
  });
  els.drop.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files.length) readFile(e.dataTransfer.files[0]);
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-sample]'), function (btn) {
    btn.addEventListener('click', function () {
      var s = window.SAMPLE_CSV[btn.getAttribute('data-sample')];
      loadText(s.text, s.name, 'UTF-8');
    });
  });

  /* ----- 設定欄の描画 ----- */
  function renderOptions() {
    renderColumnList();
    renderChips(els.dateColumns, 'date', state.dateColumns, function (list) { state.dateColumns = list; });
    renderChips(els.dedupeKeys, 'key', state.dedupeKeys, function (list) { state.dedupeKeys = list; });
  }

  function renderColumnList(focusIndex, focusDir) {
    els.columnList.textContent = '';
    state.order.forEach(function (item, pos) {
      var li = el('li', { 'class': 'columns__item' + (item.on ? '' : ' is-off') });
      var label = el('label', { 'class': 'columns__label' });
      var cb = el('input', { type: 'checkbox' });
      cb.checked = item.on;
      cb.addEventListener('change', function () {
        item.on = cb.checked;
        li.classList.toggle('is-off', !item.on);
        run();
      });
      label.appendChild(cb);
      label.appendChild(el('span', { 'class': 'columns__num' }, String(pos + 1)));
      label.appendChild(el('span', { 'class': 'columns__name' }, colName(item.index)));
      li.appendChild(label);

      var up = el('button', { type: 'button', 'class': 'icon-btn', 'aria-label': colName(item.index) + 'を上へ', 'data-dir': 'up' }, '↑');
      var down = el('button', { type: 'button', 'class': 'icon-btn', 'aria-label': colName(item.index) + 'を下へ', 'data-dir': 'down' }, '↓');
      up.disabled = pos === 0;
      down.disabled = pos === state.order.length - 1;
      up.addEventListener('click', function () { move(pos, -1); });
      down.addEventListener('click', function () { move(pos, 1); });
      li.appendChild(up);
      li.appendChild(down);
      els.columnList.appendChild(li);

      if (focusIndex === item.index) {
        var target = li.querySelector('[data-dir="' + focusDir + '"]');
        if (target && target.disabled) target = li.querySelector('.icon-btn:not([disabled])');
        if (target) target.focus();
      }
    });
  }

  function move(pos, delta) {
    var to = pos + delta;
    if (to < 0 || to >= state.order.length) return;
    var item = state.order.splice(pos, 1)[0];
    state.order.splice(to, 0, item);
    renderColumnList(item.index, delta < 0 ? 'up' : 'down');
    run();
  }

  function renderChips(container, prefix, selected, onChange) {
    container.textContent = '';
    header().forEach(function (_, i) {
      var id = prefix + '-col-' + i;
      var input = el('input', { type: 'checkbox', id: id, 'class': 'chip__input' });
      input.checked = selected.indexOf(i) !== -1;
      input.addEventListener('change', function () {
        var list = [];
        Array.prototype.forEach.call(container.querySelectorAll('input'), function (c, j) { if (c.checked) list.push(j); });
        onChange(list);
        run();
      });
      var label = el('label', { 'for': id, 'class': 'chip' }, colName(i));
      container.appendChild(input);
      container.appendChild(label);
    });
  }

  /* ----- 整形の実行と結果の表示 ----- */
  function currentOptions() {
    var dedupe = document.querySelector('input[name="dedupe"]:checked').value;
    els.dedupeKeys.hidden = dedupe !== 'keys';
    return {
      columns: state.order.filter(function (o) { return o.on; }).map(function (o) { return o.index; }),
      halfwidth: els.halfwidth.checked,
      fullKana: els.fullKana.checked,
      trim: els.trim.checked,
      dateColumns: state.dateColumns,
      dateFormat: els.dateFormat.value,
      dedupe: dedupe,
      dedupeKeys: state.dedupeKeys
    };
  }

  function run() {
    if (!state.rows) return;
    var opt = currentOptions();
    if (!opt.columns.length) {
      state.result = null;
      els.stats.textContent = '';
      els.stats.appendChild(el('li', { 'class': 'stats__item stats__item--warn' }, '出力する列が選ばれていません。STEP 2 で1つ以上チェックしてください。'));
      els.preview.textContent = '';
      els.previewNote.textContent = '';
      els.dateErrors.hidden = true;
      els.download.disabled = true;
      return;
    }
    state.result = Core.transform(state.rows, opt);
    els.download.disabled = false;
    renderStats(state.result.stats);
    renderPreview(state.result.rows);
  }

  function renderStats(s) {
    els.stats.textContent = '';
    [
      ['読み込んだ行', s.inputRows + '行'],
      ['出力する行', s.outputRows + '行'],
      ['削除した重複', s.duplicates + '行'],
      ['書き換えたセル', s.changedCells + '件']
    ].forEach(function (pair) {
      var li = el('li', { 'class': 'stats__item' });
      li.appendChild(el('span', { 'class': 'stats__label' }, pair[0]));
      li.appendChild(el('span', { 'class': 'stats__value' }, pair[1]));
      els.stats.appendChild(li);
    });

    els.dateErrors.textContent = '';
    els.dateErrors.hidden = s.dateErrors.length === 0;
    if (s.dateErrors.length) {
      els.dateErrors.appendChild(el('p', { 'class': 'notice__title' },
        '日付として読み取れなかった値が ' + s.dateErrors.length + '件あります（元の値のまま出力します）'));
      var ul = el('ul', { 'class': 'notice__list' });
      s.dateErrors.slice(0, 5).forEach(function (e) {
        ul.appendChild(el('li', null, e.row + '行目「' + e.column + '」: ' + e.value));
      });
      els.dateErrors.appendChild(ul);
    }
  }

  function renderPreview(rows) {
    els.preview.textContent = '';
    var thead = el('thead');
    var tr = el('tr');
    rows[0].forEach(function (h) { tr.appendChild(el('th', { scope: 'col' }, h)); });
    thead.appendChild(tr);
    var tbody = el('tbody');
    rows.slice(1, PREVIEW_ROWS + 1).forEach(function (r) {
      var row = el('tr');
      r.forEach(function (v) { row.appendChild(el('td', null, v)); });
      tbody.appendChild(row);
    });
    els.preview.appendChild(thead);
    els.preview.appendChild(tbody);
    var total = rows.length - 1;
    els.previewNote.textContent = total > PREVIEW_ROWS
      ? '先頭' + PREVIEW_ROWS + '行を表示しています（全' + total + '行）。'
      : '全' + total + '行を表示しています。';
  }

  ['change', 'input'].forEach(function (type) {
    [els.halfwidth, els.fullKana, els.trim, els.dateFormat].forEach(function (c) { c.addEventListener(type, run); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('input[name="dedupe"]'), function (r) {
    r.addEventListener('change', run);
  });

  /* ----- ダウンロード（UTF-8 BOM付き・CRLF。Excel 2010 でも文字化けしない） ----- */
  els.download.addEventListener('click', function () {
    if (!state.result) return;
    var name = (els.fileNameInput.value || '整形済み.csv').replace(/[\\\/:*?"<>|]/g, '_');
    if (!/\.csv$/i.test(name)) name += '.csv';
    var blob = new Blob(['﻿' + Core.toCsv(state.result.rows)], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });
})();
