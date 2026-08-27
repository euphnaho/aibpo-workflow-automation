/**
 * 各Slackワークフローが「スプレッドシートに追加する」ステップで直接書き込んだ
 * 案件リスト / 追いかけ中商談リスト / 失注リスト を巡回し、初回商談一覧（商談DB）を更新する。
 *
 * リンクトリガーにカスタム変数を渡せない（Slackワークフロー側の制約）ため、
 * calendar_idを使った突き合わせができない。代わりに以下の優先順で突き合わせる。
 *   1. 企業名（クライアント名 と 初回商談一覧の企業名(確定)/企業名取得 の完全一致）
 *      記名ルール経由の商談は最初から企業名取得が埋まっているため、通常はこれで足りる。
 *   2. 商談実施日（同じ日付）で、候補が1件のみに絞れる場合に限りマッチさせる
 *      Jicoo経由の商談は企業名取得が空欄のため、初回はこちらでマッチする。
 *      一度マッチすればその回で企業名(確定)が埋まるので、以降は1.の企業名一致で足りる。
 *      候補が複数ある場合は誤マッチを避けるため今回はスキップし、次回以降に再挑戦する
 *      （案件化・失注が確定するまで巡回対象であり続けるため、手動で企業名(確定)を
 *      埋めれば次の巡回でそれ以降1.のルートに乗る）。
 *
 * マッチした際、Slackフォームに入力された企業名（Jicoo経由の場合は正式名称に
 * 修正されている想定）を初回商談一覧の企業名(確定)へ書き込むと同時に、
 * 「突合」シートの該当行（カレンダーIDで特定）にも同じ値を書き込む。
 * 突合シートの既存列は数式で他のKPI集計から参照されている可能性があるため上書きせず、
 * 「企業名(確定)」という新しい列を追加してそこに書き込む（列が無ければ何もしない）。
 *
 * 時間主導トリガーで15分おき程度に実行する想定。
 *   実行する関数: reconcileDealSheetWrites
 */

var DEAL_LIST_SHEET_NAME = '案件リスト';
var FOLLOW_UP_SHEET_NAME = '追いかけ中商談リスト';
var LOST_LIST_SHEET_NAME = '失注リスト';
var MATCHING_SHEET_NAME = '突合';

function reconcileDealSheetWrites() {
  var config = getConfig_();
  var firstMeetingSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FIRST_MEETING_SHEET_NAME);
  if (!firstMeetingSheet) throw new Error('シートが見つかりません: ' + FIRST_MEETING_SHEET_NAME);

  var dealSs = SpreadsheetApp.openById(config.DEAL_SHEET_ID);
  var headerIndex = buildHeaderIndex_(firstMeetingSheet);
  var lastRow = firstMeetingSheet.getLastRow();
  if (lastRow < 2) return;

  var lastCol = firstMeetingSheet.getLastColumn();
  var values = firstMeetingSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  var pending = [];
  values.forEach(function (row, i) {
    var rowNumber = i + 2;
    var get = function (name) {
      var col = headerIndex[name];
      return col ? row[col - 1] : '';
    };

    var notified = get('通知済みフラグ');
    var currentAnswer = get('案件化有無');
    if (currentAnswer === '案件化' || currentAnswer === '失注') return; // 終了状態
    if (!(notified === true || notified === 'TRUE')) return;

    pending.push({
      rowNumber: rowNumber,
      calendarId: get('カレンダーID(紐付け用)'),
      companyName: String(get('企業名(確定)') || get('企業名取得') || '').trim(),
      meetingDate: get('商談実施日'),
      currentAnswer: currentAnswer
    });
  });
  if (pending.length === 0) return;

  var candidates = {
    '案件化': readDealSheetRows_(dealSs, DEAL_LIST_SHEET_NAME),
    '検討中': readDealSheetRows_(dealSs, FOLLOW_UP_SHEET_NAME),
    '失注': readDealSheetRows_(dealSs, LOST_LIST_SHEET_NAME)
  };

  pending.forEach(function (p) {
    var match = matchPendingMeeting_(p, candidates);
    if (!match) return;
    if (match.resultLabel === p.currentAnswer) return; // 変化なし

    updateRowByHeaderNames_(firstMeetingSheet, p.rowNumber, {
      '案件化有無': match.resultLabel,
      '回答日時': new Date(),
      '企業名(確定)': match.companyName,
      '担当者名(確定)': match.contactName
    });

    updateMatchingSheetCompanyName_(SpreadsheetApp.getActiveSpreadsheet(), p.calendarId, match.companyName);

    if (match.resultLabel === '案件化' || match.resultLabel === '失注') {
      closeFollowUpByCompanyName_(dealSs, match.companyName, match.resultLabel === '案件化' ? '案件化済み(卒業)' : '失注(クローズ)');
    }
  });
}

function readDealSheetRows_(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  var headerIndex = buildHeaderIndex_(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var lastCol = sheet.getLastColumn();
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  var nameCol = headerIndex['クライアント名'];
  var contactCol = headerIndex['先方担当者'];
  var dateCol = headerIndex['初回商談日'];

  return values
    .map(function (row) {
      return {
        companyName: nameCol ? String(row[nameCol - 1] || '').trim() : '',
        contactName: contactCol ? row[contactCol - 1] : '',
        meetingDate: dateCol ? row[dateCol - 1] : ''
      };
    })
    .filter(function (r) { return r.companyName; });
}

/**
 * 案件化 → 失注 → 検討中 の順に候補を探す（終了状態を優先して拾うため）。
 */
function matchPendingMeeting_(pending, candidates) {
  var order = ['案件化', '失注', '検討中'];
  for (var i = 0; i < order.length; i++) {
    var resultLabel = order[i];
    var rows = candidates[resultLabel];
    var found = pending.companyName
      ? matchByCompanyName_(rows, pending.companyName)
      : matchBySingleCandidateOnDate_(rows, pending.meetingDate);

    if (found) {
      return { resultLabel: resultLabel, companyName: found.companyName, contactName: found.contactName };
    }
  }
  return null;
}

function matchByCompanyName_(rows, companyName) {
  var matches = rows.filter(function (r) { return r.companyName === companyName; });
  return matches.length === 1 ? matches[0] : null; // 複数該当は誤マッチ防止のためスキップ
}

function matchBySingleCandidateOnDate_(rows, meetingDate) {
  if (!meetingDate) return null;
  var matches = rows.filter(function (r) { return r.meetingDate && isSameDate_(r.meetingDate, meetingDate); });
  return matches.length === 1 ? matches[0] : null; // 候補が複数なら誤マッチ防止のためスキップ
}

function isSameDate_(a, b) {
  var da = new Date(a);
  var db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

/**
 * 「突合」シートの該当行（カレンダーIDで特定）に、確定した企業名を書き込む。
 *
 * 突合シートの既存列（企業名取得 等）は数式で他のKPI集計から参照されている可能性があるため、
 * 上書きせず「企業名(確定)」という新しい列を追加してそこに書き込む。
 * 突合シートに「企業名(確定)」列が無い場合は何もしない（列追加は手動で行う）。
 */
function updateMatchingSheetCompanyName_(ss, calendarId, companyName) {
  if (!calendarId || !companyName) return;
  var sheet = ss.getSheetByName(MATCHING_SHEET_NAME);
  if (!sheet) return;

  var headerIndex = buildHeaderIndex_(sheet);
  if (!headerIndex['企業名(確定)']) return; // 列が無ければ何もしない

  var rowNumber = findRowByColumnValue_(sheet, 'カレンダーID(重複削除用)', calendarId);
  if (rowNumber === -1) return;

  updateRowByHeaderNames_(sheet, rowNumber, { '企業名(確定)': companyName });
}

/**
 * 案件化・失注により追いかけループが終わった場合、追いかけ中商談リストの行を
 * 削除はせず、ステータスを更新してNA日を消すことで再通知の対象から外す。
 */
function closeFollowUpByCompanyName_(dealSs, companyName, closedStatusLabel) {
  var sheet = dealSs.getSheetByName(FOLLOW_UP_SHEET_NAME);
  var rowNumber = findRowByColumnValue_(sheet, 'クライアント名', companyName);
  if (rowNumber === -1) return;

  updateRowByHeaderNames_(sheet, rowNumber, {
    'ステータス': closedStatusLabel,
    'NA日': ''
  });
}
