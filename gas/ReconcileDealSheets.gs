/**
 * 各Slackワークフローが「スプレッドシートに追加する」ステップで直接書き込んだ
 * 案件リスト / 追いかけ中商談リスト / 失注リスト を巡回し、初回商談一覧（商談DB）を更新する。
 *
 * Slackワークフローから GAS への直接POST（Webリクエストを送信ステップ）が
 * このワークスペースのプランでは使えなかったため、逆にGAS側がスプレッドシートの
 * 書き込み結果を後から拾いに行くPULL型の設計にしている。
 *
 * 前提: 案件リスト / 追いかけ中商談リスト / 失注リストのそれぞれに
 * 「元カレンダーID(紐付け用)」列があり、各Slackワークフローの「スプレッドシートに追加する」
 * ステップで、リンクトリガーの calendar_id 変数がその列に書き込まれること。
 *
 * 時間主導トリガーで15分おき程度に実行する想定。
 *   実行する関数: reconcileDealSheetWrites
 */

var DEAL_LIST_SHEET_NAME = '案件リスト';
var FOLLOW_UP_SHEET_NAME = '追いかけ中商談リスト';
var LOST_LIST_SHEET_NAME = '失注リスト';

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

  values.forEach(function (row, i) {
    var rowNumber = i + 2;
    var get = function (name) {
      var col = headerIndex[name];
      return col ? row[col - 1] : '';
    };

    var calendarId = get('カレンダーID(紐付け用)');
    var notified = get('通知済みフラグ');
    var currentAnswer = get('案件化有無');

    // 案件化・失注は終了状態なので、これ以上巡回対象にしない。
    if (currentAnswer === '案件化' || currentAnswer === '失注') return;
    if (!calendarId || !(notified === true || notified === 'TRUE')) return;

    var match = findDealSheetMatch_(dealSs, calendarId);
    if (!match) return;
    if (match.resultLabel === currentAnswer) return; // 変化なし（同じ検討中を毎回上書きしない）

    updateRowByHeaderNames_(firstMeetingSheet, rowNumber, {
      '案件化有無': match.resultLabel,
      '回答日時': new Date(),
      '企業名(確定)': match.companyName,
      '担当者名(確定)': match.contactName
    });

    if (match.resultLabel === '案件化' || match.resultLabel === '失注') {
      closeFollowUpIfExists_(dealSs, calendarId, match.resultLabel === '案件化' ? '案件化済み(卒業)' : '失注(クローズ)');
    }
  });
}

/**
 * 案件リスト → 追いかけ中商談リスト → 失注リストの順に探し、
 * 最初に見つかった一致行から結果を組み立てる。
 */
function findDealSheetMatch_(dealSs, calendarId) {
  return (
    findInSheet_(dealSs, DEAL_LIST_SHEET_NAME, calendarId, '案件化') ||
    findInSheet_(dealSs, FOLLOW_UP_SHEET_NAME, calendarId, '検討中') ||
    findInSheet_(dealSs, LOST_LIST_SHEET_NAME, calendarId, '失注')
  );
}

function findInSheet_(ss, sheetName, calendarId, resultLabel) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return null;

  var rowNumber = findRowByColumnValue_(sheet, '元カレンダーID(紐付け用)', calendarId);
  if (rowNumber === -1) return null;

  var headerIndex = buildHeaderIndex_(sheet);
  var get = function (name) {
    var col = headerIndex[name];
    return col ? sheet.getRange(rowNumber, col).getValue() : '';
  };

  return {
    resultLabel: resultLabel,
    companyName: get('クライアント名'),
    contactName: get('先方担当者')
  };
}

/**
 * 案件化・失注により追いかけループが終わった場合、追いかけ中商談リストの行を
 * 削除はせず、ステータスを更新してNA日を消すことで再通知の対象から外す。
 */
function closeFollowUpIfExists_(dealSs, calendarId, closedStatusLabel) {
  var sheet = dealSs.getSheetByName(FOLLOW_UP_SHEET_NAME);
  var rowNumber = findRowByColumnValue_(sheet, '元カレンダーID(紐付け用)', calendarId);
  if (rowNumber === -1) return;

  updateRowByHeaderNames_(sheet, rowNumber, {
    'ステータス': closedStatusLabel,
    'NA日': ''
  });
}
