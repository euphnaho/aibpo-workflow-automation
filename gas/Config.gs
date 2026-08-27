/**
 * スクリプトプロパティの読み書きをまとめるヘルパー。
 * 値は [スクリプトエディタ] > [プロジェクトの設定] > [スクリプト プロパティ] で設定する。
 *
 * 必須キー:
 *   SLACK_INCOMING_WEBHOOK_URL     通知先チャンネルに紐づく Incoming Webhook のURL
 *                                  （チャンネルはWebhook作成時に固定されるため、別途チャンネルID指定は不要）
 *   DEAL_SHEET_ID          案件管理シート（案件リストが入っている方）のID。
 *                          追いかけ中商談リスト・失注リストはKPI管理シート（このプロジェクトが
 *                          紐づくスプレッドシート）側に作成されたため、ここには含まれない。
 *   EXISTING_DEAL_WORKFLOW_URL     既存の「案件化した」用Slackワークフローのリンクトリガーurl
 *   WORKFLOW_LINK_TRIGGER_URL_INPROGRESS   新規「進行中（未失注）」用ワークフローのリンクトリガーURL
 *   WORKFLOW_LINK_TRIGGER_URL_LOST         新規「失注した」用ワークフローのリンクトリガーURL
 *
 * 任意キー:
 *   SOURCE_CALENDAR_ID     商談予定を走査する対象カレンダーのID（未設定ならスクリプト実行者のデフォルトカレンダー）
 *
 * このワークスペースのSlackプランでは、ワークフローからGASへ直接POSTする
 * 「Webリクエストを送信」ステップが使えないため、Web App(doPost)は使わない設計にしている。
 * 各Slackワークフローは「スプレッドシートに追加する」ステップで案件リスト/追いかけ中商談リスト/
 * 失注リストへ直接書き込み、GAS側は ReconcileDealSheets.gs の定期実行でそれを拾って
 * 初回商談一覧を更新する（PULL型）。そのため SHARED_SECRET や doPost 認証は不要。
 */
function getConfig_() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var required = [
    'SLACK_INCOMING_WEBHOOK_URL',
    'DEAL_SHEET_ID',
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
