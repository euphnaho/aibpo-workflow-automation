/**
 * スクリプトプロパティの読み書きをまとめるヘルパー。
 * 値は [スクリプトエディタ] > [プロジェクトの設定] > [スクリプト プロパティ] で設定する。
 *
 * 必須キー:
 *   SLACK_INCOMING_WEBHOOK_URL     通知先チャンネルに紐づく Incoming Webhook のURL
 *                                  （チャンネルはWebhook作成時に固定されるため、別途チャンネルID指定は不要）
 *   DEAL_SHEET_ID          案件管理シート（案件リスト/追いかけ中商談リスト/失注リストが入っている方）のID
 *   SHARED_SECRET          Slackワークフローの Web リクエストと共有する認証用文字列
 *   EXISTING_DEAL_WORKFLOW_URL     既存の「案件化した」用Slackワークフローのリンクトリガーurl
 *                                  （案件リストへの書き込みは既存ワークフロー側が担当。GASからは
 *                                  商談DB更新用の「Webリクエストを送信」ステップを1つ追加してもらう）
 *   WORKFLOW_LINK_TRIGGER_URL_INPROGRESS   新規「進行中（未失注）」用ワークフローのリンクトリガーURL
 *   WORKFLOW_LINK_TRIGGER_URL_LOST         新規「失注した」用ワークフローのリンクトリガーURL
 *
 * 任意キー:
 *   SOURCE_CALENDAR_ID     商談予定を走査する対象カレンダーのID（未設定ならスクリプト実行者のデフォルトカレンダー）
 *
 * 転記完了の報告はGASからは行わない（Slackワークフロー側の最終ステップで行う。§6参照）ため、
 * GASはIncoming Webhookで初回・再通知の2つのメッセージを送るだけで済む。
 */
function getConfig_() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var required = [
    'SLACK_INCOMING_WEBHOOK_URL',
    'DEAL_SHEET_ID',
    'SHARED_SECRET',
    'EXISTING_DEAL_WORKFLOW_URL',
    'WORKFLOW_LINK_TRIGGER_URL_INPROGRESS',
    'WORKFLOW_LINK_TRIGGER_URL_LOST'
  ];
  required.forEach(function (key) {
    if (!props[key]) {
      throw new Error('スクリプトプロパティ "' + key + '" が未設定です。');
    }
  });
  return props;
}
