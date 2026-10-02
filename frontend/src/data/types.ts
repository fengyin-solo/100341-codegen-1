/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 火险态势视图：风险等级，看板按这个分列，顺序即严重程度。 */
export type RiskLevel = '极高' | '高' | '中' | '低'

/** 风险口径：三类业务对象的状态分别折算成风险分，再按门槛定级。调整一次就产生一个新版本。 */
export type RiskCriteriaRules = {
  firewatchScores: Record<string, number>
  patrolScores: Record<string, number>
  fireteamScores: Record<string, number>
  levelThresholds: { level: RiskLevel; minScore: number }[]
}

export type RiskCriteriaVersion = {
  version: number
  label: string
  note: string
  effectiveAt: string
  rules: RiskCriteriaRules
}

export type RiskItemStatus = '待确认' | '处置中' | '已处置' | '已归档'

/** 风险处置单：值班员把某个监测点提交上火险态势看板后生成，同一监测点未归档前只允许落库一单。 */
export type RiskItem = {
  id: number
  pointCode: string
  area: string
  source: string
  level: RiskLevel
  criteriaVersion: number
  status: RiskItemStatus
  submittedBy: string
  submittedAt: string
  confirmedBy: string
  confirmedAt: string
  archivedAt: string
  patrolTaskId: number
  fireteamLogId: number
}

/** 历史运营总览记录：结转那一刻的口径与数字原样固化，之后口径怎么调都不回改。 */
export type OverviewSnapshot = {
  id: number
  takenAt: string
  takenBy: string
  criteriaVersion: number
  criteriaLabel: string
  cards: { label: string; value: number }[]
  levelCounts: { level: RiskLevel; count: number }[]
  openRiskCount: number
}

export type SituationState = {
  criteria: RiskCriteriaVersion[]
  riskItems: RiskItem[]
  snapshots: OverviewSnapshot[]
}
