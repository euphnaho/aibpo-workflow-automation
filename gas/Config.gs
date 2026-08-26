/**
 * スクリプトプロパティの読み書きをまとめるヘルパー。
 * 値は [スクリプトエディタ] > [プロジェクトの設定] > [スクリプト プロパティ] で設定する。
 *
 * 必須キー:
 *   SLACK_BOT_TOKEN        Slack Bot Token（chat:write スコープ）
 *   SLACK_CHANNEL_ID       通知先チャンネルID
 *   DEAL_SHEET_ID          案件管理シート（案件リスト/案件化中商談一覧/失注リストが入っている方）のID
 *   SHARED_SECRET          Slackワークフローの Web リクエストと共有する認証用文字列
 *   WORKFLOW_LINK_TRIGGER_URL   Slack Workflow Builder のリンクトリガーURL（末尾に ? でクエリを付与して使う）
 *
 * 任意キー:
 *   SOURCE_CALENDAR_ID     商談予定を走査する対象カレンダーのID（未設定ならスクリプト実行者のデフォルトカレンダー）
 */
function getConfig_() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var required = [
    'SLACK_BOT_TOKEN',
    'SLACK_CHANNEL_ID',
    'DEAL_SHEET_ID',
    'SHARED_SECRET',
    'WORKFLOW_LINK_TRIGGER_URL'
  ];
  required.forEach(function (key) {
    if (!props[key]) {
      throw new Error('スクリプトプロパティ "' + key + '" が未設定です。');
    }
  });
  return props;
}
