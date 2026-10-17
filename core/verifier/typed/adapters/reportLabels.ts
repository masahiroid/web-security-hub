import type { Assessment, Reachability } from '../domain/types';
import type { CampaignState, Mode, ScenarioId } from '../domain/campaignTypes';
export const RESULT_LABELS: Readonly<Record<Assessment['result'], string>> = {
  reproduced: 'Reproduced / 違反を再現',
  no_issue_observed_in_scope: 'No violation observed in these trials / 試行範囲で違反なし',
  under_investigation: 'Inconclusive / 判定不能'
};
export const REACHABILITY_LABELS: Readonly<Record<Reachability, string>> = { observed: 'Observed / 到達を確認', not_observed: 'Blocked / 遮断を確認', unavailable: 'Unavailable / 未計測' };
export const MODE_LABELS: Readonly<Record<Mode, string>> = { baseline: 'Baseline / 正常版', changed: 'Changed / 問題を入れた版', fixed: 'Fixed / 修正版' };
export const SCENARIO_LABELS: Readonly<Record<ScenarioId, string>> = { boundary: 'Boundary and Unicode / 境界値・Unicode', ownership: 'Record ownership / 所有権', workflow: 'Confirmation workflow / 確認から完了への遷移' };
export const STATE_LABELS: Readonly<Record<CampaignState, string>> = { completed: 'Execution complete / 実行完了', cancelled: 'Cancelled / 取消済み', expired: 'Deadline reached / 期限到達', timeout: 'Trial timed out / 試行timeout', budget_exhausted: 'Trial budget reached / 試行上限到達', control_failed: 'Normal control failed / 正常対照の失敗', source_changed: 'Source changed / 実行ソースの不一致', error: 'Execution error / 実行エラー' };
