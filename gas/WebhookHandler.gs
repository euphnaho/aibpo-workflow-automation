/**
 * Slack Workflow Builder の「Webリクエストを送信」ステップから呼ばれる Web App エントリポイント。
 * 想定オペレーション ステップ4〜6（案件化可否の回収〜各シートへの反映）に対応する。
 *
 * 期待するリクエストボディ(JSON)の例:
 * {
 *   "secret": "共有シークレット",
 *   "calendar_id": "初回商談一覧のカレンダーID(紐付け用)",
 *   "company_name": "...",   // Slackフォームに事前入力されるが、営業担当が編集可能。送信された値を正とする
 *   "contact_name": "...", "sales_rep": "...", "meeting_time": "...",
 *   "status": "案件化した" | "進行中（未失注）" | "失注した",
 *
 *   // status === "案件化した" の場合に使用
 *   "deal_name": "...", "expected_amount": "...", "target_area": "...", "next_meeting_date": "...",
 *
 *   // status === "進行中（未失注）" の場合に使用（NA日は再通知ループの起点として必須）
 *   "next_action": "...", "na_date": "...", "probability": "...",
 *
 *   // status === "失注した" の場合に使用
 *   "lost_type": "未案件化" | "案件化後失注", "lost_reason": "...", "lost_reason_detail": "..."
 * }
 *
 * デプロイ: [デプロイ] > [新しいデプロイ] > 種類「ウェブアプリ」
 *   実行するユーザー: 自分 / アクセスできるユーザー: 全員（Slackからの匿名POSTを受けるため）
 */

var DEAL_LIST_SHEET_NAME = '案件リスト';
var FOLLOW_UP_SHEET_NAME = '追いかけ中商談リスト';
var LOST_LIST_SHEET_NAME = '失注リスト';

function doPost(e) {
  try {
    var config = getConfig_();
    var payload = JSON.parse(e.postData.contents);

    if (payload.secret !== config.SHARED_SECRET) {
      return jsonResponse_({ ok: false, error: 'unauthorized' });
    }

    var dealSs = SpreadsheetApp.openById(config.DEAL_SHEET_ID);
    var today = new Date();
    var resultLabel;

    if (payload.status === '案件化した') {
      appendRowByHeaderNames_(dealSs.getSheetByName(DEAL_LIST_SHEET_NAME), {
        '案件登録日': today,
        'クライアント名': payload.company_name,
        '先方担当者': payload.contact_name,
        '案件名': payload.deal_name,
        '初回商談日': payload.meeting_time || today,
        '営業担当': payload.sales_rep,
        '金額（税抜）': payload.expected_amount,
        '対象業務領域': payload.target_area,
        '次回商談日': payload.next_meeting_date,
        'ステータス': '11.商談前'
      });
      closeFollowUpIfExists_(dealSs, payload.calendar_id, '案件化済み(卒業)');
      resultLabel = '案件化';

    } else if (payload.status === '進行中（未失注）') {
      if (!payload.na_date) {
        return jsonResponse_({ ok: false, error: 'na_date is required for 進行中（未失注）' });
      }
      var followUpSheet = dealSs.getSheetByName(FOLLOW_UP_SHEET_NAME);
      upsertRowByHeaderNames_(followUpSheet, '元カレンダーID(紐付け用)', payload.calendar_id, {
        '元カレンダーID(紐付け用)': payload.calendar_id,
        'クライアント名': payload.company_name,
        '先方担当者': payload.contact_name,
        '営業担当': payload.sales_rep,
        '初回商談日': payload.meeting_time || today,
        'ステータス': '検討中',
        'NA日': payload.na_date,
        'ネクストアクション': payload.next_action,
        '案件化見込み度': payload.probability
      });
      resultLabel = '検討中';

    } else if (payload.status === '失注した') {
      appendRowByHeaderNames_(dealSs.getSheetByName(LOST_LIST_SHEET_NAME), {
        '記録日': today,
        '商談実施日': payload.meeting_time || today,
        'クライアント名': payload.company_name,
        '先方担当者': payload.contact_name,
        '営業担当': payload.sales_rep,
        '失注区分': payload.lost_type,
        '失注理由': payload.lost_reason,
        '失注理由（詳細）': payload.lost_reason_detail,
        '元カレンダーID(紐付け用)': payload.calendar_id
      });
      closeFollowUpIfExists_(dealSs, payload.calendar_id, '失注(クローズ)');
      resultLabel = '失注';

    } else {
      return jsonResponse_({ ok: false, error: 'unknown status: ' + payload.status });
    }

    // 商談DB（初回商談一覧）と案件管理シート側の企業名・担当者名を、
    // 営業担当がSlackフォームで確定させた値に統一する。
    updateFirstMeetingRow_(payload.calendar_id, resultLabel, payload.company_name, payload.contact_name);
    notifySlackThread_(config, payload, resultLabel);

    return jsonResponse_({ ok: true, result: resultLabel });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  }
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

function updateFirstMeetingRow_(calendarId, resultLabel, confirmedCompanyName, confirmedContactName) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FIRST_MEETING_SHEET_NAME);
  var rowNumber = findRowByColumnValue_(sheet, 'カレンダーID(紐付け用)', calendarId);
  if (rowNumber === -1) return; // 紐付け先が見つからない場合はスキップ（ログ確認用に doPost の戻り値で分かる）

  updateRowByHeaderNames_(sheet, rowNumber, {
    '案件化有無': resultLabel,
    '回答日時': new Date(),
    '企業名(確定)': confirmedCompanyName,
    '担当者名(確定)': confirmedContactName
  });
}

function notifySlackThread_(config, payload, resultLabel) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FIRST_MEETING_SHEET_NAME);
  var rowNumber = findRowByColumnValue_(sheet, 'カレンダーID(紐付け用)', payload.calendar_id);
  if (rowNumber === -1) return;

  var headerIndex = buildHeaderIndex_(sheet);
  var tsCol = headerIndex['Slackメッセージts'];
  var ts = tsCol ? sheet.getRange(rowNumber, tsCol).getValue() : '';
  if (!ts) return;

  UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    headers: { Authorization: 'Bearer ' + config.SLACK_BOT_TOKEN },
    payload: JSON.stringify({
      channel: config.SLACK_CHANNEL_ID,
      thread_ts: ts,
      text: '転記しました: ' + (payload.company_name || '') + ' → ' + resultLabel
    }),
    muteHttpExceptions: true
  });
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
