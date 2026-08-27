/**
 * 想定オペレーション ステップ2-3:
 *   カレンダーに登録された商談予定を一括取得し、初回商談かどうかを判定して
 *   「初回商談一覧」へ追記する。
 *
 * 既存の syncCalendarToSheet()（カレンダー情報_raw への転記。他のKPI集計・
 * 「突合」シートが依存しているため一切変更しない）と同じカレンダー走査パターンを
 * ベースに、初回商談一覧専用に書き直したもの。トップレベルの変数・関数名は
 * 既存スクリプトと同じApps Scriptプロジェクトに同居しても衝突しないよう別名にしている。
 *
 * 初回判定は2ルート:
 *   - Jicoo経由の予約: 予定タイトルが「Jicoo対象リスト」シートに載っているものだけ初回とみなす
 *     （Jicoo経由かどうかは、説明欄に "Powered by Jicoo" を含むかで判定。
 *     既存のsyncCalendarToSheetのフィルター条件と同じ、実データで確認済みの条件）
 *   - Jicoo経由でない予約: タイトルが記名ルール
 *       【初回】{企業名(正式名称)}|{担当者名}様
 *     に一致するものだけ初回とみなし、企業名・担当者名をそこから抽出する。
 *
 * 時間主導トリガーで実行する想定（既存スクリプトと同じ10分おき程度）。
 *   実行する関数: collectFirstMeetings
 */

var JICOO_LIST_SHEET_NAME = 'Jicoo対象リスト';
var FIRST_MEETING_DAYS_AHEAD = 30;

// 既存の syncCalendarToSheet の CONFIG.CALENDAR_IDS と同じ一覧。
// 対象者の入退社があれば、既存スクリプト側の一覧と合わせてこちらも更新すること。
var FIRST_MEETING_CALENDAR_IDS = [
  'ryo.sakai@crowdworks.co.jp',
  'dai.takahashi@crowdworks.co.jp',
  'shun.uchiyama@crowdworks.co.jp',
  'yumeko.hanamura@crowdworks.co.jp',
  'naho.kimura@crowdworks.co.jp',
  'r.nakamura@crowdworks.co.jp',
  'tomoya.yokoyama@crowdworks.co.jp',
  'sanae.iwazoe@crowdworks.co.jp'
];

var NAMING_RULE_PATTERN = /^【初回】(.+?)[\|｜](.+?)様$/;

function collectFirstMeetings() {
  var firstMeetingSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FIRST_MEETING_SHEET_NAME);
  if (!firstMeetingSheet) throw new Error('シートが見つかりません: ' + FIRST_MEETING_SHEET_NAME);

  var jicooAllowList = loadJicooAllowList_(SpreadsheetApp.getActiveSpreadsheet());
  var existingIds = getExistingFirstMeetingCalendarIds_(firstMeetingSheet);

  var now = new Date();
  var end = new Date(now.getTime() + FIRST_MEETING_DAYS_AHEAD * 24 * 60 * 60 * 1000);

  FIRST_MEETING_CALENDAR_IDS.forEach(function (calendarId) {
    var calendar = CalendarApp.getCalendarById(calendarId);
    if (!calendar) {
      Logger.log('⚠️ カレンダーが見つかりません: ' + calendarId);
      return;
    }

    calendar.getEvents(now, end).forEach(function (event) {
      var eventId = event.getId();
      if (existingIds.indexOf(eventId) !== -1) return; // 重複除去

      var judged = judgeFirstMeeting_(event, jicooAllowList);
      if (!judged) return; // 初回商談と判定されなかったものはスキップ

      appendFirstMeetingRow_(firstMeetingSheet, event, judged);
      existingIds.push(eventId);
    });
  });
}

/**
 * 予定1件を判定する。初回商談でなければ null を返す。
 * 初回商談なら { source, companyName, contactName } を返す。
 *   source: 'Jicoo' | '記名ルール'
 *   companyName / contactName は自動抽出できた場合のみ値が入る（Jicooは空になりうる）
 */
function judgeFirstMeeting_(event, jicooAllowList) {
  var title = (event.getTitle() || '').trim();
  var description = event.getDescription() || '';

  if (isJicooSourced_(description)) {
    if (!jicooAllowList.has(title)) return null; // Jicoo対象リストに無いものは対象外
    return { source: 'Jicoo', companyName: '', contactName: '' };
  }

  var match = title.match(NAMING_RULE_PATTERN);
  if (!match) return null; // 記名ルールに従っていないものは対象外
  return {
    source: '記名ルール',
    companyName: match[1].trim(),
    contactName: match[2].trim()
  };
}

function isJicooSourced_(description) {
  return description.indexOf('Powered by Jicoo') !== -1;
}

function loadJicooAllowList_(ss) {
  var sheet = ss.getSheetByName(JICOO_LIST_SHEET_NAME);
  if (!sheet) throw new Error('シートが見つかりません: ' + JICOO_LIST_SHEET_NAME);

  var lastRow = sheet.getLastRow();
  var set = new Set();
  if (lastRow < 2) return set;

  var values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  values.forEach(function (row) {
    var v = String(row[0] || '').trim();
    if (v) set.add(v);
  });
  return set;
}

function getExistingFirstMeetingCalendarIds_(sheet) {
  var headerIndex = buildHeaderIndex_(sheet);
  var col = headerIndex['カレンダーID(紐付け用)'];
  if (!col) return [];

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var values = sheet.getRange(2, col, lastRow - 1, 1).getValues();
  return values.map(function (r) { return r[0]; }).filter(function (v) { return v !== ''; });
}

function appendFirstMeetingRow_(sheet, event, judged) {
  // 既存のsyncCalendarToSheetと同様、作成者+ゲストのうち社内(@crowdworks.co.jp)のみを参加者として扱う。
  var creators = event.getCreators() || [];
  var guests = event.getGuestList().map(function (g) { return g.getEmail(); });
  var attendees = uniqueInternalEmails_(creators.concat(guests));

  appendRowByHeaderNames_(sheet, {
    'カレンダーID(紐付け用)': event.getId(),
    '商談ソース': judged.source,
    '企業名取得': judged.companyName,
    '企業担当者名取得': judged.contactName,
    '商談実施日': event.getStartTime(),
    '参加者①': attendees[0] || '',
    '参加者②': attendees[1] || '',
    '参加者③': attendees[2] || '',
    '通知済みフラグ': false
  });
}

function uniqueInternalEmails_(emails) {
  var seen = {};
  var result = [];
  emails.forEach(function (email) {
    if (!email || seen[email]) return;
    if (email.indexOf('@crowdworks.co.jp') === -1) return;
    seen[email] = true;
    result.push(email);
  });
  return result;
}
