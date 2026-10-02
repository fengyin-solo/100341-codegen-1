/** 火险态势领域的类型：风险事件、口径版本、总览快照。 */

// 风险等级：看板从高到低分列
export type RiskLevel = '高' | '中' | '低'

// 处置阶段：也是风险卡片的处置进度
// 待核实 → 已派单（写巡护待办、队伍台账）→ 处置中 → 已确认 → 已归档（冻结）
export type RiskStage = '待核实' | '已派单' | '处置中' | '已确认' | '已归档'

// 风险来源：提交风险点时从火险监测点快照而来
export type RiskSource = {
  监测点编号: string
  监测区域: string
  火险等级: string
  风力等级: string
  相对湿度: string
  气温读数: string
  监测时间: string
  监测状态: string
}

export type RiskTimelineItem = {
  time: string
  stage: RiskStage
  operator: string
  note: string
}

export type RiskEvent = {
  id: number
  // 风险点唯一键（监测点编号 + 区域）：同一未归档风险点只允许先落库的一次提交生效
  pointKey: string
  source: RiskSource
  level: RiskLevel
  stage: RiskStage
  criteriaVersion: number
  reporter: string
  createdAt: string
  updatedAt: string
  timeline: RiskTimelineItem[]
  // 派单后联动出去的真实事项编号，归档/重算都不影响它们已经落库
  patrolTaskCode: string
  teamCode: string
  teamName: string
  archived: boolean
}

// 口径版本：statusLevelRules 描述监测状态如何映射风险等级
export type RiskCriteria = {
  version: number
  name: string
  changedAt: string
  note: string
  statusLevelRules: Record<string, RiskLevel>
}

// 运营总览的历史快照：生成时按当时口径冻结，之后口径再调也不重算
export type OverviewSnapshot = {
  id: number
  takenAt: string
  operator: string
  criteriaVersion: number
  criteriaName: string
  high: number
  medium: number
  low: number
  active: number
  archived: number
  pendingDisposal: number
}

export type RiskState = {
  seq: number
  criteriaSeq: number
  snapshotSeq: number
  currentCriteriaVersion: number
  criteria: RiskCriteria[]
  risks: RiskEvent[]
  snapshots: OverviewSnapshot[]
}

export type SubmitRiskInput = {
  monitorPointId: number
  reporter: string
  note?: string
}

export type SubmitRiskResult = {
  ok: boolean
  message: string
  risk?: RiskEvent
  // 并发落库时输给了谁
  conflictWith?: RiskEvent
}
