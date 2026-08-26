/**
 * 想定オペレーション ステップ 2-3:
 *   カレンダーに登録された商談予定を一括取得し、初回商談かどうかを判定して
 *   「初回商談一覧」へ upsert する。
 *
 * 初回判定は2ルート:
 *   - Jicoo経由の予約: 予定のタイトルが「Jicoo対象リスト」シートに載っているものだけ初回とみなす
 *     （Jicoo予約はJicoo側が自動生成したタイトルのまま。記名ルールは適用しない）
 *   - Jicoo経由でない予約: タイトルが記名ルール
 *       【初回】{企業名(正式名称)}|{担当者名}様
 *     に一致するものだけ初回とみなし、企業名・担当者名をそこから抽出する。
 *
 * 【要検証】Jicoo経由かどうかの判定方法:
 *   実装時点でJicoo予約とそれ以外を確実に見分ける情報が無かったため、
 *   予定の説明欄(description)または場所欄(location)に "jicoo" という文字列
 *   （Jicoo予約時にJicooが自動挿入するURL等）が含まれるかで仮判定している。
 *   実際のカレンダーデータで成立するか確認し、成立しなければ判定条件を差し替えること。
 *
 * 時間主導トリガーで 1日1回程度実行する想定。
 *   実行する関数: collectFirstMeetings
 */

var JICOO_LIST_SHEET_NAME = 'Jicoo対象リスト';
var LOOKBACK_DAYS = 3;   // 何日前まで遡って走査するか
var LOOKAHEAD_DAYS = 14; // 何日先まで走査するか（予定登録が早いケースを拾う）

var NAMING_RULE_PATTERN = /^【初回】(.+?)[\|｜](.+?)様$/;

function collectFirstMeetings() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var firstMeetingSheet = ss.getSheetByName(FIRST_MEETING_SHEET_NAME);
  if (!firstMeetingSheet) throw new Error('シートが見つかりません: ' + FIRST_MEETING_SHEET_NAME);

  var jicooAllowList = loadJicooAllowList_(ss);
  var calendar = getSourceCalendar_();

  var now = new Date();
  var start = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  var end = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
  var events = calendar.getEvents(start, end);

  events.forEach(function (event) {
    var judged = judgeFirstMeeting_(event, jicooAllowList);
    if (!judged) return; // 初回商談と判定されなかったものはスキップ

    upsertFirstMeetingRow_(firstMeetingSheet, event, judged);
  });
}

/**
 * 予定1件を判定する。初回商談でなければ null を返す。
 * 初回商談なら { source, companyName, contactName } を返す。
 *   source: 'Jicoo' | '記名ルール'
 *   companyName / contactName は自動抽出できた場合のみ値が入る（Jicooは空になりうる）
 */
function judgeFirstMeeting_(event, jicooAllowList) {
  var title = event.getTitle() || '';
  var isJicoo = isJicooSourced_(event);

  if (isJicoo) {
    if (!jicooAllowList.has(title.trim())) return null; // Jicoo対象リストに無いものは対象外
    return { source: 'Jicoo', companyName: '', contactName: '' };
  }

  var match = title.trim().match(NAMING_RULE_PATTERN);
  if (!match) return null; // 記名ルールに従っていないものは対象外
  return {
    source: '記名ルール',
    companyName: match[1].trim(),
    contactName: match[2].trim()
  };
}

function isJicooSourced_(event) {
  var text = ((event.getDescription() || '') + ' ' + (event.getLocation() || '')).toLowerCase();
  return text.indexOf('jicoo') !== -1;
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

function getSourceCalendar_() {
  var props = PropertiesService.getScriptProperties().getProperties();
  if (props.SOURCE_CALENDAR_ID) {
    return CalendarApp.getCalendarById(props.SOURCE_CALENDAR_ID);
  }
  return CalendarApp.getDefaultCalendar();
}

/**
 * 既に同じカレンダーIDの行があれば何もしない（初回判定・企業名は最初の取得時点のものを正とする）。
 * 無ければ新規行を追加する。
 */
function upsertFirstMeetingRow_(sheet, event, judged) {
  var calendarId = event.getId();
  var existingRow = findRowByColumnValue_(sheet, 'カレンダーID(紐付け用)', calendarId);
  if (existingRow !== -1) return;

  var guests = event.getGuestList().map(function (g) { return g.getEmail(); });

  appendRowByHeaderNames_(sheet, {
    'カレンダーID(紐付け用)': calendarId,
    '商談ソース': judged.source,
    '企業名取得': judged.companyName,
    '企業担当者名取得': judged.contactName,
    '商談実施日': event.getStartTime(),
    '参加者①': guests[0] || '',
    '参加者②': guests[1] || '',
    '参加者③': guests[2] || '',
    '通知済みフラグ': false
  });
}
