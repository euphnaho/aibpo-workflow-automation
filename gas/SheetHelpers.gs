/**
 * シート操作の共通関数。
 */

/**
 * ヘッダー行（1行目）から列名→列インデックス(1始まり)のマップを作る。
 */
function buildHeaderIndex_(sheet) {
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var index = {};
  headers.forEach(function (name, i) {
    if (name) index[String(name).trim()] = i + 1;
  });
  return index;
}

/**
 * 指定シートで、ある列(headerName)の値が targetValue に一致する最初の行番号を返す。
 * 見つからなければ -1。
 */
function findRowByColumnValue_(sheet, headerName, targetValue) {
  var headerIndex = buildHeaderIndex_(sheet);
  var col = headerIndex[headerName];
  if (!col) throw new Error('列 "' + headerName + '" が見つかりません: ' + sheet.getName());

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  var values = sheet.getRange(2, col, lastRow - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === String(targetValue).trim()) {
      return i + 2; // 1始まり・ヘッダー分オフセット
    }
  }
  return -1;
}

/**
 * ヘッダー名をキーにした連想配列(rowObj)を、シートの最終行に追記する。
 * ヘッダーに無いキーは無視する。
 */
function appendRowByHeaderNames_(sheet, rowObj) {
  var headerIndex = buildHeaderIndex_(sheet);
  var lastCol = sheet.getLastColumn();
  var row = new Array(lastCol).fill('');

  Object.keys(rowObj).forEach(function (key) {
    var col = headerIndex[key];
    if (col) row[col - 1] = rowObj[key];
  });

  sheet.appendRow(row);
}

/**
 * ヘッダー名をキーにした連想配列で、指定行を部分更新する。
 */
function updateRowByHeaderNames_(sheet, rowNumber, rowObj) {
  var headerIndex = buildHeaderIndex_(sheet);
  Object.keys(rowObj).forEach(function (key) {
    var col = headerIndex[key];
    if (col) sheet.getRange(rowNumber, col).setValue(rowObj[key]);
  });
}
