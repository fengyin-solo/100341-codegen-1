import { loadOverview } from '@/api/local-service'
import { listRows, refreshFromStorage, saveRows } from '@/data/local-store'
import { readSituation, writeSituation } from '@/data/situation-store'
import type {
  ActionResult,
  EntryRow,
  OverviewSnapshot,
  RiskCriteriaRules,
  RiskCriteriaVersion,
  RiskItem,
  RiskLevel,
  SituationState,
} from '@/data/types'

// 看板列顺序即风险严重程度。
export const RISK_LEVELS: RiskLevel[] = ['极高', '高', '中', '低']
export const RISK_SOURCES = ['火险监测', '气象观测', '无人机巡查', '巡护上报', '群众报警']
export const RISK_ITEM_FLOW = ['待确认', '处置中', '已处置', '已归档']

// 所有会改态势数据的操作共用一把锁：两名值班员（两个浏览器标签页）同时提交时，
// 锁内重新读库再判断，先落库的生效，后到的在锁里读到结果后被拒。
const LOCK_NAME = 'forest-fire-patrol:situation-write'

async function withSituationLock<T>(fn: () => T): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (locks) {
    return (await locks.request(LOCK_NAME, () => fn())) as T
  }
  return fn()
}

function pad4(value: number): string {
  return String(value).padStart(4, '0')
}

function now(): string {
  const d = new Date()
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  return `${date} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function nextId(rows: { id: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

export function currentCriteria(state: SituationState = readSituation()): RiskCriteriaVersion {
  return state.criteria[state.criteria.length - 1]
}

export function criteriaHistory(): RiskCriteriaVersion[] {
  return [...readSituation().criteria].reverse()
}

export function levelForScore(score: number, thresholds: RiskCriteriaRules['levelThresholds']): RiskLevel {
  const sorted = [...thresholds].sort((a, b) => b.minScore - a.minScore)
  for (const item of sorted) {
    if (score >= item.minScore) {
      return item.level
    }
  }
  return sorted[sorted.length - 1]?.level ?? '低'
}

function firewatchLevel(status: string, rules: RiskCriteriaRules): RiskLevel {
  return levelForScore(rules.firewatchScores[status] ?? 0, rules.levelThresholds)
}

/** 看板卡片：三类业务对象各算一个风险等级，按等级进列。 */
export type BoardCard = {
  kind: '监测点' | '巡护任务' | '扑火队伍'
  refId: number
  code: string
  title: string
  status: string
  level: RiskLevel
}

export function loadBoard(): { level: RiskLevel; cards: BoardCard[] }[] {
  refreshFromStorage()
  const rules = currentCriteria().rules
  const cards: BoardCard[] = []
  for (const row of listRows('firewatch')) {
    const status = String(row.status)
    cards.push({
      kind: '监测点',
      refId: Number(row.id),
      code: String(row['监测点编号'] ?? ''),
      title: String(row['监测区域'] ?? ''),
      status,
      level: firewatchLevel(status, rules),
    })
  }
  for (const row of listRows('patrol')) {
    const status = String(row.status)
    cards.push({
      kind: '巡护任务',
      refId: Number(row.id),
      code: String(row['任务编号'] ?? ''),
      title: String(row['巡护区域'] ?? ''),
      status,
      level: levelForScore(rules.patrolScores[status] ?? 0, rules.levelThresholds),
    })
  }
  for (const row of listRows('fireteam')) {
    const status = String(row.status)
    cards.push({
      kind: '扑火队伍',
      refId: Number(row.id),
      code: String(row['队伍编号'] ?? ''),
      title: String(row['队伍名称'] ?? ''),
      status,
      level: levelForScore(rules.fireteamScores[status] ?? 0, rules.levelThresholds),
    })
  }
  return RISK_LEVELS.map((level) => ({
    level,
    cards: cards.filter((card) => card.level === level),
  }))
}

export function listRiskItems(): RiskItem[] {
  return [...readSituation().riskItems].sort((a, b) => b.id - a.id)
}

/** 提交表单的候选项：每个监测点标出当前等级，以及是否已有未归档风险单（有则不能再提交）。 */
export function listSubmittablePoints(): {
  code: string
  area: string
  status: string
  level: RiskLevel
  occupied: boolean
}[] {
  refreshFromStorage()
  const state = readSituation()
  const rules = currentCriteria(state).rules
  const occupied = new Set(
    state.riskItems.filter((item) => item.status !== '已归档').map((item) => item.pointCode),
  )
  return listRows('firewatch').map((row) => {
    const status = String(row.status)
    return {
      code: String(row['监测点编号'] ?? ''),
      area: String(row['监测区域'] ?? ''),
      status,
      level: firewatchLevel(status, rules),
      occupied: occupied.has(String(row['监测点编号'] ?? '')),
    }
  })
}

export function listSnapshots(): OverviewSnapshot[] {
  return [...readSituation().snapshots].sort((a, b) => b.id - a.id)
}

/** 风险来源分布：只统计还没归档的风险单，归档的不再占当前态势。 */
export function sourceSummary(): { source: string; count: number }[] {
  const open = readSituation().riskItems.filter((item) => item.status !== '已归档')
  const counts = new Map<string, number>()
  for (const source of RISK_SOURCES) {
    counts.set(source, 0)
  }
  for (const item of open) {
    counts.set(item.source, (counts.get(item.source) ?? 0) + 1)
  }
  return [...counts.entries()].map(([source, count]) => ({ source, count }))
}

export function statusSummary(): { status: string; count: number }[] {
  const items = readSituation().riskItems
  return RISK_ITEM_FLOW.map((status) => ({
    status,
    count: items.filter((item) => item.status === status).length,
  }))
}

export type SubmitResult = ActionResult & { item?: RiskItem }

/**
 * 值班员把监测点提交上态势看板。同一监测点只要还有未归档的风险单，
 * 后来的一律不落库——锁内直读 localStorage 判重，两个标签页并发也只生效先到的一单。
 */
export function submitRiskPoint(input: {
  pointCode: string
  source: string
  operator: string
}): Promise<SubmitResult> {
  return withSituationLock(() => {
    refreshFromStorage()
    const state = readSituation()
    const pointCode = input.pointCode.trim()
    const existing = state.riskItems.find(
      (item) => item.pointCode === pointCode && item.status !== '已归档',
    )
    if (existing) {
      return {
        ok: false,
        message: `风险点 ${pointCode} 已由 ${existing.submittedBy} 于 ${existing.submittedAt} 落库（当前${existing.status}），本次提交未生效`,
      }
    }
    const point = listRows('firewatch').find((row) => String(row['监测点编号']) === pointCode)
    if (!point) {
      return { ok: false, message: `没有找到监测点 ${pointCode}，不能提交` }
    }
    const criteria = currentCriteria(state)
    const item: RiskItem = {
      id: nextId(state.riskItems),
      pointCode,
      area: String(point['监测区域'] ?? ''),
      source: input.source,
      level: firewatchLevel(String(point.status), criteria.rules),
      criteriaVersion: criteria.version,
      status: '待确认',
      submittedBy: input.operator,
      submittedAt: now(),
      confirmedBy: '',
      confirmedAt: '',
      archivedAt: '',
      patrolTaskId: 0,
      fireteamLogId: 0,
    }
    writeSituation({ ...state, riskItems: [...state.riskItems, item] })
    return {
      ok: true,
      message: `风险点 ${pointCode} 已落库，风险等级「${item.level}」，等待确认处置`,
      item,
    }
  })
}

/**
 * 确认处置：风险单转入「处置中」，同时往巡护任务、扑火队伍各追加一条真实记录——
 * 巡护待办和队伍台账跟着多出来的不是总览数字，是各自模块里能查到的新行。
 * 只在「待确认」状态可执行，重复确认不会重复生成联动记录。
 */
export function confirmDisposal(id: number, operator: string): Promise<ActionResult> {
  return withSituationLock(() => {
    refreshFromStorage()
    const state = readSituation()
    const item = state.riskItems.find((entry) => entry.id === id)
    if (!item) {
      return { ok: false, message: `没有找到编号为 ${id} 的风险单` }
    }
    if (item.status !== '待确认') {
      return { ok: false, message: `风险单已是「${item.status}」，不能重复确认处置` }
    }
    const patrolRows = listRows('patrol')
    const patrolId = nextId(patrolRows)
    const patrolTask: EntryRow = {
      id: patrolId,
      status: '待执行',
      pending: true,
      abnormal: false,
      任务编号: `PATR-${pad4(patrolId)}`,
      巡护区域: item.area,
      巡护路线: `火险处置联动·${item.pointCode}`,
      巡护员: operator,
      巡护日期: today(),
      巡护时段: '处置联动',
      发现火情数: '0',
      任务状态: '待执行',
      关联风险点: item.pointCode,
    }
    saveRows('patrol', [...patrolRows, patrolTask])
    const teamRows = listRows('fireteam')
    const teamId = nextId(teamRows)
    const teamLog: EntryRow = {
      id: teamId,
      status: '已出动',
      pending: true,
      abnormal: false,
      队伍编号: `TEAM-${pad4(teamId)}`,
      队伍名称: `风险处置增援队·${item.pointCode}`,
      所属林场: item.area,
      队长姓名: operator,
      队员人数: '10',
      集结半径: '5公里',
      值班状态: '已出动',
      出动状态: '已出动',
      关联风险点: item.pointCode,
    }
    saveRows('fireteam', [...teamRows, teamLog])
    const riskItems = state.riskItems.map((entry): RiskItem =>
      entry.id === id
        ? {
            ...entry,
            status: '处置中',
            confirmedBy: operator,
            confirmedAt: now(),
            patrolTaskId: patrolId,
            fireteamLogId: teamId,
          }
        : entry,
    )
    writeSituation({ ...state, riskItems })
    return {
      ok: true,
      message: `已确认处置：巡护待办 PATR-${pad4(patrolId)}、队伍台账 TEAM-${pad4(teamId)} 已同步生成`,
    }
  })
}

export function completeDisposal(id: number): Promise<ActionResult> {
  return withSituationLock(() => {
    const state = readSituation()
    const item = state.riskItems.find((entry) => entry.id === id)
    if (!item) {
      return { ok: false, message: `没有找到编号为 ${id} 的风险单` }
    }
    if (item.status !== '处置中') {
      return { ok: false, message: `风险单当前是「${item.status}」，只有处置中才能办结` }
    }
    const riskItems = state.riskItems.map((entry): RiskItem =>
      entry.id === id ? { ...entry, status: '已处置' } : entry,
    )
    writeSituation({ ...state, riskItems })
    return { ok: true, message: `风险单 ${item.pointCode} 已办结，可归档` }
  })
}

/** 归档后风险单退出当前态势：不再按新口径重算，同一监测点也允许再次提交。 */
export function archiveRiskItem(id: number): Promise<ActionResult> {
  return withSituationLock(() => {
    const state = readSituation()
    const item = state.riskItems.find((entry) => entry.id === id)
    if (!item) {
      return { ok: false, message: `没有找到编号为 ${id} 的风险单` }
    }
    if (item.status !== '已处置') {
      return { ok: false, message: `风险单当前是「${item.status}」，办结后才能归档` }
    }
    const riskItems = state.riskItems.map((entry): RiskItem =>
      entry.id === id ? { ...entry, status: '已归档', archivedAt: now() } : entry,
    )
    writeSituation({ ...state, riskItems })
    return { ok: true, message: `风险单 ${item.pointCode} 已归档，等级「${item.level}」按 V${item.criteriaVersion} 口径封存` }
  })
}

/**
 * 调整风险口径：生成新口径版本，未归档风险单立刻按新口径重算等级；
 * 已归档风险单和历史总览快照保持当时口径，一律不回改。
 */
export function adjustCriteria(
  note: string,
  rules: RiskCriteriaRules,
): Promise<ActionResult & { version?: number }> {
  return withSituationLock(() => {
    refreshFromStorage()
    const state = readSituation()
    const previous = currentCriteria(state)
    const version = previous.version + 1
    const next: RiskCriteriaVersion = {
      version,
      label: `V${version} 调整口径`,
      note: note.trim() || '人工调整风险口径',
      effectiveAt: now(),
      rules,
    }
    const riskItems = state.riskItems.map((item) => {
      if (item.status === '已归档') {
        return item
      }
      const point = listRows('firewatch').find((row) => String(row['监测点编号']) === item.pointCode)
      const score = point ? (rules.firewatchScores[String(point.status)] ?? 0) : 0
      return { ...item, level: levelForScore(score, rules.levelThresholds), criteriaVersion: version }
    })
    writeSituation({ criteria: [...state.criteria, next], riskItems, snapshots: state.snapshots })
    return {
      ok: true,
      version,
      message: `口径已调整为 V${version}：未归档风险单按新口径重算，历史总览记录保持原口径`,
    }
  })
}

/** 结转当前运营总览：把这一刻的总览卡片、风险等级分布和口径版本固化成历史记录。 */
export function takeOverviewSnapshot(operator: string): Promise<OverviewSnapshot> {
  return withSituationLock(() => {
    refreshFromStorage()
    const state = readSituation()
    const criteria = currentCriteria(state)
    const open = state.riskItems.filter((item) => item.status !== '已归档')
    const snapshot: OverviewSnapshot = {
      id: nextId(state.snapshots),
      takenAt: now(),
      takenBy: operator,
      criteriaVersion: criteria.version,
      criteriaLabel: criteria.label,
      cards: loadOverview().cards,
      levelCounts: RISK_LEVELS.map((level) => ({
        level,
        count: open.filter((item) => item.level === level).length,
      })),
      openRiskCount: open.length,
    }
    writeSituation({ ...state, snapshots: [...state.snapshots, snapshot] })
    return snapshot
  })
}
