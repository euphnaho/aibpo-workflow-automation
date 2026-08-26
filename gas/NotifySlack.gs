/**
 * Slack通知まわり。2つのタイミングで同じ「案件化可否を聞く」通知を送る。
 *
 *  1. notifyCompletedFirstMeetings  … 想定オペレーション ステップ4（初回）
 *     「初回商談一覧」を巡回し、商談が終了しているのに未通知の行があれば通知する。
 *  2. renotifyDueFollowUps          … 想定オペレーション ステップ6（NA日が来たら4へ戻る）
 *     「追いかけ中商談リスト」を巡回し、NA日を迎えていて本日まだ再通知していない行があれば通知する。
 *
 * どちらも時間主導トリガーで実行する想定（15分〜1時間おき程度）。
 *
 * 注意: 現状のシートには「商談終了時刻」の列が無いため、
 *   商談実施日(開始時刻) + MEETING_DEFAULT_DURATION_MINUTES 分 を終了時刻とみなす。
 */

var FIRST_MEETING_SHEET_NAME = '初回商談一覧';
var MEETING_DEFAULT_DURATION_MINUTES = 60;

function notifyCompletedFirstMeetings() {
  var config = getConfig_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(FIRST_MEETING_SHEET_NAME);
  if (!sheet) throw new Error('シートが見つかりません: ' + FIRST_MEETING_SHEET_NAME);

  var headerIndex = buildHeaderIndex_(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var lastCol = sheet.getLastColumn();
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var now = new Date();

  values.forEach(function (row, i) {
    var rowNumber = i + 2;
    var get = function (name) {
      var col = headerIndex[name];
      return col ? row[col - 1] : '';
    };

    var meetingTime = get('商談実施日');
    var calendarId = get('カレンダーID(紐付け用)');
    var alreadyNotified = get('通知済みフラグ');

    if (!meetingTime || !calendarId || alreadyNotified === true || alreadyNotified === 'TRUE') {
      return;
    }

    var endTime = getMeetingEndTime_(meetingTime);
    if (now < endTime) return; // まだ商談中/未実施

    var meeting = {
      calendarId: calendarId,
      companyName: get('企業名取得'),
      contactName: get('企業担当者名取得'),
      salesRep: get('参加者①'),
      meetingTime: meetingTime
    };

    var ts = postSlackNotification_(config, meeting, 'initial');

    updateRowByHeaderNames_(sheet, rowNumber, {
      '通知済みフラグ': true,
      'Slackメッセージts': ts
    });
  });
}

/**
 * 「追いかけ中商談リスト」でNA日を迎えた行に対し、再度「案件化可否」を聞く通知を送る。
 * 想定オペレーション ステップ6（NA日に再度案件化可否を回収 → ステップ4へ戻る）に対応。
 */
function renotifyDueFollowUps() {
  var config = getConfig_();
  var dealSs = SpreadsheetApp.openById(config.DEAL_SHEET_ID);
  var sheet = dealSs.getSheetByName(FOLLOW_UP_SHEET_NAME);
  if (!sheet) throw new Error('シートが見つかりません: ' + FOLLOW_UP_SHEET_NAME);

  var headerIndex = buildHeaderIndex_(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var lastCol = sheet.getLastColumn();
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var today = stripTime_(new Date());

  values.forEach(function (row, i) {
    var rowNumber = i + 2;
    var get = function (name) {
      var col = headerIndex[name];
      return col ? row[col - 1] : '';
    };

    var naDate = get('NA日');
    if (!naDate) return;

    var naDay = stripTime_(new Date(naDate));
    if (naDay > today) return; // まだNA日に達していない

    var lastNotifiedRaw = get('直近通知日');
    if (lastNotifiedRaw) {
      var lastNotifiedDay = stripTime_(new Date(lastNotifiedRaw));
      if (lastNotifiedDay.getTime() === today.getTime()) return; // 本日すでに再通知済み
    }

    var meeting = {
      calendarId: get('元カレンダーID(紐付け用)'),
      companyName: get('クライアント名'),
      contactName: get('先方担当者'),
      salesRep: get('営業担当'),
      meetingTime: get('初回商談日')
    };

    var ts = postSlackNotification_(config, meeting, 'followup');

    updateRowByHeaderNames_(sheet, rowNumber, {
      '直近通知日': new Date(),
      '再通知Slackメッセージts': ts
    });
  });
}

function stripTime_(date) {
  var d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function getMeetingEndTime_(meetingStart) {
  var start = new Date(meetingStart);
  return new Date(start.getTime() + MEETING_DEFAULT_DURATION_MINUTES * 60 * 1000);
}

/**
 * Slackへ通知メッセージを投稿し、スレッド返信用の ts を返す。
 * リンクボタンには Slack Workflow のリンクトリガーURLに
 * calendar_id / company_name / contact_name / sales_rep をクエリパラメータとして付与する。
 */
function postSlackNotification_(config, meeting, kind) {
  var workflowUrl = buildWorkflowLinkUrl_(config.WORKFLOW_LINK_TRIGGER_URL, meeting);
  var headline = kind === 'followup' ? '*ネクストアクション日になりました*' : '*商談が終了しました*';

  var blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: headline +
          '\n企業名: ' + (meeting.companyName || '(未取得)') +
          '\n先方担当者: ' + (meeting.contactName || '(未取得)') +
          '\n営業担当: ' + (meeting.salesRep || '(未取得)') +
          '\n商談日時: ' + Utilities.formatDate(new Date(meeting.meetingTime), 'JST', 'yyyy-MM-dd HH:mm')
      }
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '案件化可否を報告する' },
          url: workflowUrl,
          style: 'primary'
        }
      ]
    }
  ];

  var response = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    headers: { Authorization: 'Bearer ' + config.SLACK_BOT_TOKEN },
    payload: JSON.stringify({
      channel: config.SLACK_CHANNEL_ID,
      blocks: blocks,
      text: headline + ': ' + (meeting.companyName || '')
    }),
    muteHttpExceptions: true
  });

  var json = JSON.parse(response.getContentText());
  if (!json.ok) {
    throw new Error('Slack通知に失敗しました: ' + json.error);
  }
  return json.ts;
}

function buildWorkflowLinkUrl_(baseUrl, meeting) {
  var params = {
    calendar_id: meeting.calendarId || '',
    company_name: meeting.companyName || '',
    contact_name: meeting.contactName || '',
    sales_rep: meeting.salesRep || ''
  };
  var query = Object.keys(params)
    .map(function (k) { return k + '=' + encodeURIComponent(params[k]); })
    .join('&');
  return baseUrl + (baseUrl.indexOf('?') >= 0 ? '&' : '?') + query;
}
