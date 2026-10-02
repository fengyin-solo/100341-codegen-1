import type { RiskCriteriaVersion, SituationState } from './types'

// 火险态势数据单独存一个 key：口径版本、风险处置单、历史总览快照。
// 与 entries 不同，这里每次读写都直接走 localStorage、不做内存缓存——
// 两名值班员两个标签页并发时，任何一方读到的都是对方已落库的最新值。
const STORAGE_KEY = 'forest-fire-patrol:situation'

// 默认口径 V1：状态越严重分值越高，再按门槛定级。
const DEFAULT_CRITERIA: RiskCriteriaVersion = {
  version: 1,
  label: 'V1 默认口径',
  note: '初始口径：按监测/任务/出动状态折算风险分',
  effectiveAt: '2026-09-01T08:00:00',
  rules: {
    firewatchScores: { 正常: 0, 蓝色预警: 1, 黄色预警: 2, 橙色预警: 3, 红色预警: 4 },
    patrolScores: { 待执行: 2, 执行中: 3, 已完成: 0, 已取消: 0 },
    fireteamScores: { 在营待命: 1, 已出动: 3, 扑救中: 4, 已撤回: 0, 休整中: 0 },
    levelThresholds: [
      { level: '极高', minScore: 4 },
      { level: '高', minScore: 3 },
      { level: '中', minScore: 2 },
      { level: '低', minScore: 0 },
    ],
  },
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedState(): SituationState {
  return { criteria: [clone(DEFAULT_CRITERIA)], riskItems: [], snapshots: [] }
}

function normalize(parsed: Partial<SituationState> | null): SituationState {
  const fallback = seedState()
  if (!parsed || typeof parsed !== 'object') {
    return fallback
  }
  return {
    criteria: parsed.criteria?.length ? parsed.criteria : fallback.criteria,
    riskItems: parsed.riskItems ?? [],
    snapshots: parsed.snapshots ?? [],
  }
}

export function readSituation(): SituationState {
  if (typeof window === 'undefined' || !window.localStorage) {
    return seedState()
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seeded = seedState()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
  try {
    return normalize(JSON.parse(raw) as Partial<SituationState>)
  } catch {
    const seeded = seedState()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
}

export function writeSituation(next: SituationState): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function situationStorageKey(): string {
  return STORAGE_KEY
}
