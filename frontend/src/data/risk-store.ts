import { listRows, saveRows } from './local-store'
import type { EntryRow } from './types'
import type { RiskEvent, RiskState } from './risk-types'

// 火险态势独立持久化：风险事件、口径版本、总览历史快照各归各位。
const STORAGE_KEY = 'forest-fire-patrol:risk-state'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 巡护待办 / 队伍台账的联动记录：由风险处置实际写入两个业务模块的数据里，
// 不是挂在总览上的虚拟数字，所以在巡检、队伍页面能直接看到。
const LINKED_PATROL: EntryRow[] = [
  {
    id: 9001,
    status: '执行中',
    pending: true,
    abnormal: false,
    任务编号: 'PATR-RISK-01',
    巡护区域: '火险监测样例2',
    巡护路线: '沿橙色预警点 R302 周边巡护线',
    巡护员: '王巡护',
    巡护日期: '2026-10-01',
    巡护时段: '20:00-次日02:00',
    发现火情数: '0',
    任务状态: '执行中',
    来源风险: 'FRISK-1002',
  },
]

const LINKED_TEAM: EntryRow[] = [
  {
    id: 9001,
    status: '扑救中',
    pending: true,
    abnormal: false,
    队伍编号: 'TEAM-RISK-01',
    队伍名称: '青松林场半专业扑火一队（火险联动）',
    所属林场: '青松林场',
    队长姓名: '马队长',
    队员人数: '18',
    集结半径: '15km',
    值班状态: '应急值班',
    出动状态: '扑救中',
    来源风险: 'FRISK-1002',
  },
]

function seedState(): RiskState {
  const state: RiskState = {
    seq: 1003,
    criteriaSeq: 1,
    snapshotSeq: 0,
    currentCriteriaVersion: 1,
    criteria: [
      {
        version: 1,
        name: '秋季常规火险口径',
        changedAt: '2026-09-01 08:00',
        note: '红/橙预警计高风险，黄色预警计中风险，蓝/正常计低风险',
        statusLevelRules: {
          红色预警: '高',
          橙色预警: '高',
          黄色预警: '中',
          蓝色预警: '低',
          正常: '低',
        },
      },
    ],
    risks: [
      {
        id: 1001,
        pointKey: 'FIRE-0003@火险监测样例3',
        source: {
          监测点编号: 'FIRE-0003',
          监测区域: '火险监测样例3',
          火险等级: '三级',
          风力等级: '4级',
          相对湿度: '28%',
          气温读数: '27℃',
          监测时间: '2026-10-01 14:20',
          监测状态: '黄色预警',
        },
        level: '中',
        stage: '待核实',
        criteriaVersion: 1,
        reporter: '值班员甲',
        createdAt: '2026-10-01 14:30',
        updatedAt: '2026-10-01 14:30',
        timeline: [
          { time: '2026-10-01 14:30', stage: '待核实', operator: '值班员甲', note: '巡检发现黄色预警点，上报待核实' },
        ],
        patrolTaskCode: '',
        teamCode: '',
        teamName: '',
        archived: false,
      },
      {
        id: 1002,
        pointKey: 'FIRE-0002@火险监测样例2',
        source: {
          监测点编号: 'FIRE-0002',
          监测区域: '火险监测样例2',
          火险等级: '四级',
          风力等级: '5级',
          相对湿度: '22%',
          气温读数: '31℃',
          监测时间: '2026-10-01 18:05',
          监测状态: '橙色预警',
        },
        level: '高',
        stage: '处置中',
        criteriaVersion: 1,
        reporter: '值班员乙',
        createdAt: '2026-10-01 18:20',
        updatedAt: '2026-10-01 20:10',
        timeline: [
          { time: '2026-10-01 18:20', stage: '待核实', operator: '值班员乙', note: '橙色预警，烟点核实属实' },
          { time: '2026-10-01 19:00', stage: '已派单', operator: '值班管理员', note: '已派巡护任务 PATR-RISK-01，队伍 TEAM-RISK-01 出动' },
          { time: '2026-10-01 20:10', stage: '处置中', operator: '马队长', note: '队伍抵达，正在开设隔离带' },
        ],
        patrolTaskCode: 'PATR-RISK-01',
        teamCode: 'TEAM-RISK-01',
        teamName: '青松林场半专业扑火一队',
        archived: false,
      },
      {
        id: 1003,
        pointKey: 'FIRE-0001@火险监测样例1',
        source: {
          监测点编号: 'FIRE-0001',
          监测区域: '火险监测样例1',
          火险等级: '二级',
          风力等级: '3级',
          相对湿度: '46%',
          气温读数: '24℃',
          监测时间: '2026-09-28 09:00',
          监测状态: '蓝色预警',
        },
        level: '低',
        stage: '已归档',
        criteriaVersion: 1,
        reporter: '值班员甲',
        createdAt: '2026-09-28 09:30',
        updatedAt: '2026-09-28 17:00',
        timeline: [
          { time: '2026-09-28 09:30', stage: '待核实', operator: '值班员甲', note: '蓝色预警点，安排核查' },
          { time: '2026-09-28 11:00', stage: '已派单', operator: '值班员甲', note: '派单核查，无明火' },
          { time: '2026-09-28 15:00', stage: '处置中', operator: '巡护组', note: '现场蹲守观察' },
          { time: '2026-09-28 16:30', stage: '已确认', operator: '值班员甲', note: '确认处置完毕，无火情' },
          { time: '2026-09-28 17:00', stage: '已归档', operator: '值班管理员', note: '归档备查' },
        ],
        patrolTaskCode: '',
        teamCode: '',
        teamName: '',
        archived: true,
      },
    ],
    snapshots: [],
  }
  return state
}

// 首次播种时，把示例联动记录真正写进巡护任务、扑火队伍两个模块。
function seedLinkedRows() {
  const patrol = listRows('patrol')
  if (!patrol.some((row) => row.任务编号 === 'PATR-RISK-01')) {
    saveRows('patrol', [...patrol, ...clone(LINKED_PATROL)])
  }
  const team = listRows('fireteam')
  if (!team.some((row) => row.队伍编号 === 'TEAM-RISK-01')) {
    saveRows('fireteam', [...team, ...clone(LINKED_TEAM)])
  }
}

let cache: RiskState | null = null

function readStorage(): RiskState {
  const fallback = seedState()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    seedLinkedRows()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    return JSON.parse(raw) as RiskState
  } catch {
    seedLinkedRows()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

export function getRiskState(): RiskState {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function saveRiskState(state: RiskState): void {
  cache = state
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }
}

export function resetRiskState(): RiskState {
  const fresh = seedState()
  seedLinkedRows()
  saveRiskState(fresh)
  return fresh
}

export function riskStorageKey(): string {
  return STORAGE_KEY
}

// 供风险服务写入联动事项时取下一个模块内编号
export function nextModuleId(key: string): number {
  const rows = listRows(key)
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

export { LINKED_PATROL, LINKED_TEAM }
