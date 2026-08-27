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
      companyName: get('企業名取得'),
      contactName: get('企業担当者名取得'),
      salesRep: get('参加者①'),
      meetingTime: meetingTime
    };

    postSlackNotification_(config, meeting, 'initial');

    updateRowByHeaderNames_(sheet, rowNumber, {
      '通知済みフラグ': true
    });
  });
}

/**
 * 「追いかけ中商談リスト」でNA日を迎えた行に対し、再度「案件化可否」を聞く通知を送る。
 * 想定オペレーション ステップ6（NA日に再度案件化可否を回収 → ステップ4へ戻る）に対応。
 *
 * 追いかけ中商談リストはKPI管理シート（このスクリプトが紐づくスプレッドシート）側に
 * 作成されたため、DEAL_SHEET_ID（案件管理シート）ではなくアクティブなスプレッドシートを見る。
 */
function renotifyDueFollowUps() {
  var config = getConfig_();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FOLLOW_UP_SHEET_NAME);
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
      companyName: get('クライアント名'),
      contactName: get('先方担当者'),
      salesRep: get('営業担当'),
      meetingTime: get('初回商談日')
    };

    postSlackNotification_(config, meeting, 'followup');

    updateRowByHeaderNames_(sheet, rowNumber, {
      '直近通知日': new Date()
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
 * Slackへ通知メッセージを Incoming Webhook で投稿する。
 * ボタンは3つ:
 *   案件化した       → 既存の「案件化」Slackワークフロー（案件リストへの書き込みは既存WF側が担当）
 *   進行中（未失注） → 新規ワークフロー（NA日を回収し追いかけ中商談リストへ）
 *   失注した         → 新規ワークフロー（失注理由を回収し失注リストへ）
 *
 * リンクトリガーにカスタム変数を渡せない（Slackワークフロー側の制約）ため、
 * ボタンは各ワークフローへの単純なリンクにし、企業名・担当者名等はメッセージ本文に
 * 記載する。営業担当はそれをコピペしてフォームに入力する（既存の案件化ワークフローも
 * もともと手入力の運用のため、これで従来と同じ使用感になる）。
 * Jicoo経由で企業名が未取得の場合は、フォームで正式名称を入力してもらう
 * （ReconcileDealSheets.gs が入力された名称を商談DB・突合シートへ反映する）。
 */
function postSlackNotification_(config, meeting, kind) {
  var headline = kind === 'followup' ? '*ネクストアクション日になりました*' : '*商談が終了しました*';
  var companyLine = meeting.companyName
    ? '\n企業名: ' + meeting.companyName
    : '\n企業名: (未取得・Jicoo経由のためフォームで正式名称を入力してください)';

  var blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: headline +
          companyLine +
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
          text: { type: 'plain_text', text: '案件化した' },
          url: config.EXISTING_DEAL_WORKFLOW_URL,
          style: 'primary'
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '進行中（未失注）' },
          url: config.WORKFLOW_LINK_TRIGGER_URL_INPROGRESS
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '失注した' },
          url: config.WORKFLOW_LINK_TRIGGER_URL_LOST
        }
      ]
    }
  ];

  postToIncomingWebhook_(config, {
    blocks: blocks,
    text: headline + ': ' + (meeting.companyName || '(未取得)')
  });
}

/**
 * Incoming Webhookへメッセージを投稿する共通関数。
 * 成功時のレスポンスボディはプレーンテキストの "ok"（JSONでもtsでもない）。
 */
function postToIncomingWebhook_(config, message) {
  var response = UrlFetchApp.fetch(config.SLACK_INCOMING_WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    payload: JSON.stringify(message),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200 || response.getContentText() !== 'ok') {
    throw new Error('Slack通知に失敗しました: ' + response.getResponseCode() + ' ' + response.getContentText());
  }
}
