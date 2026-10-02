import { getRiskState, nextModuleId, saveRiskState } from '@/data/risk-store'
import { listRows, saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'
import type {
  OverviewSnapshot,
  RiskCriteria,
  RiskEvent,
  RiskLevel,
  RiskSource,
  RiskStage,
  SubmitRiskInput,
  SubmitRiskResult,
} from '@/data/risk-types'

// 火险态势服务：风险点提交、处置流转、跨模块联动、口径版本与总览快照都在这里。
// 与 local-service 一样是纯前端同步落库：同一次事件循环里的两次提交，
// 后一次一定能读到前一次的写入，天然实现「只允许先落库的一次生效」。

const RISK_CODE_PREFIX = 'FRISK'
const STAGE_ORDER: RiskStage[] = ['待核实', '已派单', '处置中', '已确认', '已归档']

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function listCriteria(): RiskCriteria[] {
  return getRiskState().criteria
}

export function currentCriteria(): RiskCriteria {
  const state = getRiskState()
  return (
    state.criteria.find((item) => item.version === state.currentCriteriaVersion) ??
    state.criteria[state.criteria.length - 1]
  )
}

// 未归档记录实时按当前口径算等级；已归档记录冻结在归档时的等级上。
export function levelOf(risk: RiskEvent, criteria: RiskCriteria = currentCriteria()): RiskLevel {
  if (risk.archived) {
    return risk.level
  }
  return criteria.statusLevelRules[risk.source.监测状态] ?? risk.level
}

export function decorate(risk: RiskEvent): RiskEvent {
  return { ...risk, level: levelOf(risk) }
}

export function listRiskEvents(): RiskEvent[] {
  return getRiskState().risks.map((risk) => decorate(risk))
}

export function getRiskEvent(id: number): RiskEvent | undefined {
  const risk = getRiskState().risks.find((item) => item.id === id)
  return risk ? decorate(risk) : undefined
}

function toSource(row: EntryRow): RiskSource {
  return {
    监测点编号: String(row.监测点编号 ?? ''),
    监测区域: String(row.监测区域 ?? ''),
    火险等级: String(row.火险等级 ?? ''),
    风力等级: String(row.风力等级 ?? ''),
    相对湿度: String(row.相对湿度 ?? ''),
    气温读数: String(row.气温读数 ?? ''),
    监测时间: String(row.监测时间 ?? ''),
    监测状态: String(row.status ?? ''),
  }
}

// 提交下拉里可选的火险监测点
export function monitorPointOptions(): { id: number; label: string; status: string }[] {
  return listRows('firewatch').map((row) => ({
    id: Number(row.id),
    label: `${String(row.监测点编号)}｜${String(row.监测区域)}`,
    status: String(row.status),
  }))
}

function pushTimeline(risk: RiskEvent, stage: RiskStage, operator: string, note: string, time = nowText()) {
  risk.timeline.push({ time, stage, operator, note })
  risk.stage = stage
  risk.updatedAt = time
}

/**
 * 提交风险点。同一监测点存在未归档风险时拒绝重复落库，
 * 返回先落库那条作为冲突方 —— 两名值班员并发提交时只有第一次提交生效。
 */
export function submitRisk(input: SubmitRiskInput & { reporter: string }): SubmitRiskResult {
  const state = getRiskState()
  const monitor = listRows('firewatch').find((row) => Number(row.id) === Number(input.monitorPointId))
  if (!monitor) {
    return { ok: false, message: '请选择有效的火险监测点' }
  }
  const source = toSource(monitor)
  const pointKey = `${source.监测点编号}@${source.监测区域}`
  const existed = state.risks.find((item) => !item.archived && item.pointKey === pointKey)
  if (existed) {
    return {
      ok: false,
      message: `该风险点已有未归档记录 ${RISK_CODE_PREFIX}-${existed.id}（${existed.reporter} 先于您提交，当前「${existed.stage}」），本次提交不生效`,
      conflictWith: decorate(existed),
    }
  }

  state.seq += 1
  const time = nowText()
  const criteria = currentCriteria()
  const risk: RiskEvent = {
    id: state.seq,
    pointKey,
    source,
    level: criteria.statusLevelRules[source.监测状态] ?? '中',
    stage: '待核实',
    criteriaVersion: criteria.version,
    reporter: input.reporter,
    createdAt: time,
    updatedAt: time,
    timeline: [
      {
        time,
        stage: '待核实',
        operator: input.reporter,
        note: input.note?.trim() || `监测点${source.监测状态}，提交风险点待核实`,
      },
    ],
    patrolTaskCode: '',
    teamCode: '',
    teamName: '',
    archived: false,
  }
  state.risks.unshift(risk)
  saveRiskState(state)
  return { ok: true, message: `风险点 ${RISK_CODE_PREFIX}-${risk.id} 已落库，等级「${risk.level}」`, risk }
}

/**
 * 并发演示：两名值班员对同一风险点在同一批次内先后落库，
 * 顺序处理提交请求，验证只有第一名提交者生效。
 */
export function submitRiskConcurrent(
  monitorPointId: number,
  reporters: [string, string],
): SubmitRiskResult[] {
  return reporters.map((reporter) => submitRisk({ monitorPointId, reporter }))
}

function updateRisk(id: number, mutate: (risk: RiskEvent) => { ok: boolean; message: string }): SubmitRiskResult {
  const state = getRiskState()
  const risk = state.risks.find((item) => item.id === id)
  if (!risk) {
    return { ok: false, message: '没有找到这条风险记录' }
  }
  if (risk.archived) {
    return { ok: false, message: `风险 ${RISK_CODE_PREFIX}-${id} 已归档，记录按归档时口径冻结，不能再处置` }
  }
  const result = mutate(risk)
  if (!result.ok) {
    return result
  }
  saveRiskState(state)
  return result
}

// 可派队伍：台账里在营待命的队伍优先，同时允许手填
export function dispatchableTeams(): { code: string; name: string }[] {
  return listRows('fireteam')
    .filter((row) => String(row.status) === '在营待命')
    .map((row) => ({ code: String(row.队伍编号), name: String(row.队伍名称) }))
}

/**
 * 值班员确认处置：风险点进入「已派单」，同时在巡护任务、扑火队伍两个模块
 * 各真实写入一份事项，而不只是改总览数字。
 */
export function confirmHandleRisk(
  id: number,
  operator: string,
  team: { code: string; name: string },
): SubmitRiskResult {
  const state = getRiskState()
  const risk = state.risks.find((item) => item.id === id)
  if (!risk) {
    return { ok: false, message: '没有找到这条风险记录' }
  }
  if (risk.archived) {
    return { ok: false, message: '风险已归档，不能再派单' }
  }
  if (risk.stage !== '待核实') {
    return { ok: false, message: `当前「${risk.stage}」，待核实状态才能确认处置并派单` }
  }
  if (!team.code.trim() || !team.name.trim()) {
    return { ok: false, message: '请选择或填写出动队伍' }
  }

  const date = nowText().slice(0, 10)
  const patrolCode = `PATR-RISK-${String(id).slice(-4)}`
  const teamCode = `TEAM-RISK-${String(id).slice(-4)}`

  // ① 巡护待办多出一份事项
  const patrolRows = listRows('patrol')
  if (!patrolRows.some((row) => row.任务编号 === patrolCode)) {
    const patrolRow: EntryRow = {
      id: nextModuleId('patrol'),
      status: '待执行',
      pending: true,
      abnormal: false,
      任务编号: patrolCode,
      巡护区域: risk.source.监测区域,
      巡护路线: `围绕监测点 ${risk.source.监测点编号} 的火险核查线`,
      巡护员: operator,
      巡护日期: date,
      巡护时段: '应急派单 当日',
      发现火情数: '0',
      任务状态: '待执行',
      来源风险: `${RISK_CODE_PREFIX}-${id}`,
    }
    saveRows('patrol', [...patrolRows, patrolRow])
  }

  // ② 队伍台账多出一份事项
  const teamRows = listRows('fireteam')
  if (!teamRows.some((row) => row.队伍编号 === teamCode)) {
    const teamRow: EntryRow = {
      id: nextModuleId('fireteam'),
      status: '已出动',
      pending: true,
      abnormal: false,
      队伍编号: teamCode,
      队伍名称: team.name,
      所属林场: '火险联动调度',
      队长姓名: '待指派',
      队员人数: '—',
      集结半径: '以风险点就近集结',
      值班状态: '应急值班',
      出动状态: '已出动',
      来源风险: `${RISK_CODE_PREFIX}-${id}`,
    }
    saveRows('fireteam', [...teamRows, teamRow])
  }

  risk.patrolTaskCode = patrolCode
  risk.teamCode = teamCode
  risk.teamName = team.name
  pushTimeline(risk, '已派单', operator, `确认处置：巡护待办 ${patrolCode}、队伍台账 ${teamCode}（${team.name}）已同步生成`)
  saveRiskState(state)
  return {
    ok: true,
    message: `已确认处置并派单：巡护任务 ${patrolCode}、队伍出动 ${teamCode} 均已落库`,
    risk: decorate(risk),
  }
}

export function reportHandling(id: number, operator: string, note: string): SubmitRiskResult {
  return updateRisk(id, (risk) => {
    if (risk.stage !== '已派单') {
      return { ok: false, message: `当前「${risk.stage}」，已派单状态才能反馈处置进展` }
    }
    pushTimeline(risk, '处置中', operator, note.trim() || '现场反馈：正在处置')
    return { ok: true, message: `已反馈处置进展，风险 ${RISK_CODE_PREFIX}-${id} 进入处置中` }
  })
}

export function confirmFinishRisk(id: number, operator: string, note: string): SubmitRiskResult {
  return updateRisk(id, (risk) => {
    if (risk.stage !== '处置中') {
      return { ok: false, message: `当前「${risk.stage}」，处置中状态才能确认完成` }
    }
    pushTimeline(risk, '已确认', operator, note.trim() || '现场处置完成，隐患排除')
    return { ok: true, message: `风险 ${RISK_CODE_PREFIX}-${id} 已确认处置完成` }
  })
}

// 归档：等级与口径版本就此冻结，之后口径调整不再重算这条
export function archiveRisk(id: number, operator: string): SubmitRiskResult {
  return updateRisk(id, (risk) => {
    if (risk.stage !== '已确认') {
      return { ok: false, message: `当前「${risk.stage}」，确认完成后才能归档` }
    }
    risk.level = levelOf(risk)
    risk.criteriaVersion = currentCriteria().version
    risk.archived = true
    pushTimeline(risk, '已归档', operator, `归档备查，按口径 v${risk.criteriaVersion} 冻结`)
    return { ok: true, message: `风险 ${RISK_CODE_PREFIX}-${id} 已归档` }
  })
}

export type BoardLane = { level: RiskLevel; risks: RiskEvent[] }

export type RiskBoard = {
  lanes: BoardLane[]
  activeCount: number
  archivedCount: number
  pendingCount: number
}

export function loadRiskBoard(): RiskBoard {
  const risks = listRiskEvents()
  const active = risks.filter((risk) => !risk.archived)
  const lanes: BoardLane[] = (['高', '中', '低'] as RiskLevel[]).map((level) => ({
    level,
    risks: active
      .filter((risk) => risk.level === level)
      .sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage)),
  }))
  return {
    lanes,
    activeCount: active.length,
    archivedCount: risks.length - active.length,
    pendingCount: active.filter((risk) => risk.stage === '待核实').length,
  }
}

export function stagePercent(stage: RiskStage): number {
  if (stage === '已归档') {
    return 100
  }
  return Math.round(((STAGE_ORDER.indexOf(stage) + 1) / (STAGE_ORDER.length - 1)) * 100)
}

/**
 * 调整风险口径：生成新版本；所有未归档记录立即按新口径重算，
 * 已归档记录（含其等级与时间线）保持归档时口径不变。
 */
export function publishCriteria(input: { name: string; note: string; rules: Record<string, RiskLevel> }): RiskCriteria {
  const state = getRiskState()
  const previous = currentCriteria()
  state.criteriaSeq += 1
  const criteria: RiskCriteria = {
    version: state.criteriaSeq,
    name: input.name.trim() || `火险口径 v${state.criteriaSeq}`,
    changedAt: nowText(),
    note: input.note.trim(),
    statusLevelRules: { ...input.rules },
  }
  state.criteria.push(criteria)
  state.currentCriteriaVersion = criteria.version

  for (const risk of state.risks) {
    if (risk.archived) {
      continue
    }
    const before = levelOf(risk, previous)
    const after = criteria.statusLevelRules[risk.source.监测状态] ?? risk.level
    risk.level = after
    risk.criteriaVersion = criteria.version
    if (before !== after) {
      risk.updatedAt = criteria.changedAt
      risk.timeline.push({
        time: criteria.changedAt,
        stage: risk.stage,
        operator: '系统',
        note: `口径升级到 v${criteria.version}，等级由「${before}」重算为「${after}」`,
      })
    }
  }
  saveRiskState(state)
  return criteria
}

export function listSnapshots(): OverviewSnapshot[] {
  return [...getRiskState().snapshots].sort((a, b) => (a.takenAt < b.takenAt ? 1 : -1))
}

// 生成运营总览历史快照：数字与当时口径一起冻结，之后永不重算
export function takeSnapshot(operator: string): OverviewSnapshot {
  const state = getRiskState()
  const criteria = currentCriteria()
  const risks = state.risks
  const levelCount = (level: RiskLevel) =>
    risks.filter((risk) => !risk.archived && levelOf(risk, criteria) === level).length
  state.snapshotSeq += 1
  const snapshot: OverviewSnapshot = {
    id: state.snapshotSeq,
    takenAt: nowText(),
    operator,
    criteriaVersion: criteria.version,
    criteriaName: criteria.name,
    high: levelCount('高'),
    medium: levelCount('中'),
    low: levelCount('低'),
    active: risks.filter((risk) => !risk.archived).length,
    archived: risks.filter((risk) => risk.archived).length,
    pendingDisposal: risks.filter((risk) => !risk.archived && risk.stage === '待核实').length,
  }
  state.snapshots.push(snapshot)
  saveRiskState(state)
  return snapshot
}
