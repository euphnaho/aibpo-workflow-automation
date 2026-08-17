/**
 * 「初回商談一覧」を巡回し、商談が終了しているのに未通知の行があれば
 * Slackへ通知（+ 結果報告ワークフローへのリンクボタン）を送る。
 *
 * 時間主導トリガーで 15分おき程度に実行する想定。
 *   [トリガー] > [トリガーを追加] > 実行する関数: notifyCompletedFirstMeetings
 *   イベントのソース: 時間主導型 / 分ベースのタイマー / 15分おき
 *
 * 前提: 「初回商談一覧」に以下の列が存在すること（設計書 4.1 参照）
 *   企業名取得, 企業担当者名取得, 商談実施日, カレンダーID(紐付け用),
 *   通知済みフラグ, Slackメッセージts, 案件化有無, 回答日時
 *
 * 注意: 現状のシートには「商談終了時刻」の列が無いため、
 *   商談実施日(開始時刻) + MEETING_DEFAULT_DURATION_MINUTES 分 を終了時刻とみなす。
 *   実データにカレンダーの終了時刻列を追加できる場合は、
 *   getMeetingEndTime_ の実装をその列参照に差し替えること。
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

    var companyName = get('企業名取得');
    var contactName = get('企業担当者名取得');
    var salesRep = get('参加者①');

    var ts = postSlackNotification_(config, {
      calendarId: calendarId,
      companyName: companyName,
      contactName: contactName,
      salesRep: salesRep,
      meetingTime: meetingTime
    });

    updateRowByHeaderNames_(sheet, rowNumber, {
      '通知済みフラグ': true,
      'Slackメッセージts': ts
    });
  });
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
function postSlackNotification_(config, meeting) {
  var workflowUrl = buildWorkflowLinkUrl_(config.WORKFLOW_LINK_TRIGGER_URL, meeting);

  var blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*商談が終了しました*\n企業名: ' + (meeting.companyName || '(未取得)') +
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
          text: { type: 'plain_text', text: '商談結果を報告する' },
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
      text: '商談が終了しました: ' + (meeting.companyName || '')
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
