<template>
  <section class="page" data-module="situation">
    <header class="page-head">
      <div>
        <h2>火险态势视图</h2>
        <p class="page-desc">
          监测点、巡护任务、扑火队伍按风险同上一条看板，风险来源与处置进度同页跟进。
          当前口径：{{ criteria.label }}（{{ criteria.effectiveAt }} 生效）
        </p>
      </div>
      <div class="page-actions">
        <label class="operator-switch">
          值班员
          <select :value="store.operator" @change="switchOperator">
            <option v-for="name in operatorOptions" :key="name" :value="name">{{ name }}</option>
          </select>
        </label>
        <button class="btn primary" type="button" @click="showSubmit = !showSubmit">提交风险点</button>
        <button class="btn" type="button" @click="openCriteriaForm">调整风险口径</button>
        <button class="btn" type="button" @click="snapshot">结转当前总览</button>
        <button class="btn ghost" type="button" @click="reload">刷新</button>
      </div>
    </header>

    <form v-if="showSubmit" class="panel" @submit.prevent="submit">
      <h3 class="panel-title">提交风险点（两名值班员同时提交同一监测点时，只生效先落库的一单）</h3>
      <div class="panel-row">
        <label class="filter-item">
          <span>监测点</span>
          <select v-model="submitForm.pointCode">
            <option value="" disabled>选择监测点</option>
            <option
              v-for="point in points"
              :key="point.code"
              :value="point.code"
              :disabled="point.occupied"
            >
              {{ point.code }} · {{ point.area }} · {{ point.status }}（{{ point.level }}）{{ point.occupied ? '·已落库' : '' }}
            </option>
          </select>
        </label>
        <label class="filter-item">
          <span>风险来源</span>
          <select v-model="submitForm.source">
            <option v-for="source in sources" :key="source" :value="source">{{ source }}</option>
          </select>
        </label>
        <button class="btn primary" type="submit">落库</button>
      </div>
    </form>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <h3 class="section-title">风险看板（按当前口径定级）</h3>
    <div class="board-row">
      <div v-for="column in board" :key="column.level" class="board-col" :data-level="column.level">
        <header class="board-head">
          <span class="board-level">{{ column.level }}</span>
          <span class="board-count">{{ column.cards.length }}</span>
        </header>
        <article v-for="card in column.cards" :key="`${card.kind}-${card.refId}`" class="board-card">
          <span class="card-kind">{{ card.kind }}</span>
          <strong class="card-code">{{ card.code }}</strong>
          <span class="card-title">{{ card.title }}</span>
          <span class="card-status">{{ card.status }}</span>
        </article>
        <p v-if="!column.cards.length" class="board-empty">暂无</p>
      </div>
    </div>

    <div class="two-col">
      <section class="panel">
        <h3 class="panel-title">风险来源（未归档风险单）</h3>
        <ul class="source-list">
          <li v-for="item in sourceStats" :key="item.source">
            <span>{{ item.source }}</span>
            <strong>{{ item.count }}</strong>
          </li>
        </ul>
      </section>

      <section class="panel">
        <h3 class="panel-title">处置进度</h3>
        <p class="status-legend">
          <span v-for="item in flowStats" :key="item.status" class="legend-item">
            {{ item.status }}：{{ item.count }}
          </span>
        </p>
        <ul class="risk-list">
          <li v-for="item in riskItems" :key="item.id" class="risk-item">
            <div class="risk-line">
              <strong>{{ item.pointCode }}</strong>
              <span class="risk-level" :data-level="item.level">{{ item.level }}</span>
              <span class="risk-meta">{{ item.area }} · 来源：{{ item.source }} · 口径 V{{ item.criteriaVersion }}</span>
            </div>
            <div class="risk-line">
              <span class="risk-meta">
                {{ item.submittedBy }} 提交于 {{ item.submittedAt }}
                <template v-if="item.confirmedBy"> · {{ item.confirmedBy }} 确认于 {{ item.confirmedAt }}</template>
                <template v-if="item.archivedAt"> · 归档于 {{ item.archivedAt }}</template>
              </span>
            </div>
            <div class="risk-line">
              <ol class="flow-steps">
                <li
                  v-for="(step, index) in flow"
                  :key="step"
                  :class="{ done: index <= flowIndex(item.status) }"
                >
                  {{ step }}
                </li>
              </ol>
              <span class="row-actions">
                <button v-if="item.status === '待确认'" class="link" type="button" @click="confirm(item.id)">确认处置</button>
                <button v-if="item.status === '处置中'" class="link" type="button" @click="complete(item.id)">处置办结</button>
                <button v-if="item.status === '已处置'" class="link" type="button" @click="archive(item.id)">归档</button>
              </span>
            </div>
            <div v-if="item.patrolTaskId" class="risk-line">
              <span class="risk-meta">
                联动记录：巡护待办 PATR-{{ pad(item.patrolTaskId) }} · 队伍台账 TEAM-{{ pad(item.fireteamLogId) }}
              </span>
            </div>
          </li>
          <li v-if="!riskItems.length" class="empty-state">暂无风险单，可先从监测点提交</li>
        </ul>
      </section>
    </div>

    <section v-if="showCriteria" class="panel">
      <h3 class="panel-title">调整风险口径（保存后未归档记录按新口径重算，历史总览记录不回改）</h3>
      <div class="criteria-grid">
        <div v-for="group in criteriaGroups" :key="group.title" class="criteria-block">
          <h4>{{ group.title }}</h4>
          <label v-for="(value, status) in group.scores" :key="status" class="criteria-item">
            <span>{{ status }}</span>
            <input v-model.number="group.scores[status]" type="number" min="0" max="9" />
          </label>
        </div>
        <div class="criteria-block">
          <h4>等级门槛（分数 ≥ 门槛即该级）</h4>
          <label v-for="level in levels" :key="level" class="criteria-item">
            <span>{{ level }}</span>
            <input v-model.number="criteriaForm.thresholds[level]" type="number" min="0" max="9" />
          </label>
        </div>
      </div>
      <div class="panel-row">
        <label class="filter-item grow">
          <span>调整说明</span>
          <input v-model="criteriaForm.note" placeholder="例如：进入防火紧要期，上调巡护任务权重" />
        </label>
        <button class="btn primary" type="button" @click="saveCriteria">保存为新口径</button>
      </div>
    </section>

    <section class="panel">
      <h3 class="panel-title">历史运营总览记录（按结转时口径保留，口径调整不回改）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>结转时间</th><th>口径</th><th>开放风险</th>
            <th v-for="level in levels" :key="level">{{ level }}</th>
            <th>登记总量</th><th>待处理</th><th>异常量</th><th>结转人</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="snap in snapshots" :key="snap.id">
            <td>{{ snap.takenAt }}</td>
            <td>V{{ snap.criteriaVersion }} {{ snap.criteriaLabel }}</td>
            <td>{{ snap.openRiskCount }}</td>
            <td v-for="level in levels" :key="level">{{ levelCount(snap, level) }}</td>
            <td>{{ cardValue(snap, '登记总量') }}</td>
            <td>{{ cardValue(snap, '待处理') }}</td>
            <td>{{ cardValue(snap, '异常量') }}</td>
            <td>{{ snap.takenBy }}</td>
          </tr>
          <tr v-if="!snapshots.length">
            <td :colspan="levels.length + 6" class="empty-state">还没有结转记录，点右上角「结转当前总览」留档</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span v-if="notice" class="notice-text">{{ notice }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  RISK_ITEM_FLOW,
  RISK_LEVELS,
  RISK_SOURCES,
  adjustCriteria,
  archiveRiskItem,
  completeDisposal,
  confirmDisposal,
  currentCriteria,
  listRiskItems,
  listSnapshots,
  listSubmittablePoints,
  loadBoard,
  sourceSummary,
  statusSummary,
  submitRiskPoint,
  takeOverviewSnapshot,
} from '@/api/situation-service'
import type {
  OverviewSnapshot,
  RiskCriteriaRules,
  RiskItemStatus,
  RiskLevel,
} from '@/data/types'
import { OPERATOR_OPTIONS, useSessionStore } from '@/stores/session'

const store = useSessionStore()
const operatorOptions = OPERATOR_OPTIONS
const levels = RISK_LEVELS
const sources = RISK_SOURCES
const flow = RISK_ITEM_FLOW

const board = ref<ReturnType<typeof loadBoard>>([])
const riskItems = ref<ReturnType<typeof listRiskItems>>([])
const snapshots = ref<OverviewSnapshot[]>([])
const sourceStats = ref<{ source: string; count: number }[]>([])
const flowStats = ref<{ status: string; count: number }[]>([])
const points = ref<ReturnType<typeof listSubmittablePoints>>([])
const criteria = ref(currentCriteria())
const notice = ref('')
const errorMessage = ref('')
const showSubmit = ref(false)
const showCriteria = ref(false)
const submitForm = ref({ pointCode: '', source: RISK_SOURCES[0] })
const criteriaForm = ref({
  note: '',
  firewatchScores: {} as Record<string, number>,
  patrolScores: {} as Record<string, number>,
  fireteamScores: {} as Record<string, number>,
  thresholds: {} as Record<RiskLevel, number>,
})

const criteriaGroups = computed(() => [
  { title: '监测点状态分值', scores: criteriaForm.value.firewatchScores },
  { title: '巡护任务状态分值', scores: criteriaForm.value.patrolScores },
  { title: '扑火队伍状态分值', scores: criteriaForm.value.fireteamScores },
])

const stats = computed(() => {
  const open = riskItems.value.filter((item) => item.status !== '已归档')
  return [
    { label: '开放风险单', value: open.length },
    { label: '待确认', value: countOf('待确认') },
    { label: '处置中', value: countOf('处置中') },
    { label: '已归档', value: countOf('已归档') },
  ]
})

function countOf(status: string): number {
  return riskItems.value.filter((item) => item.status === status).length
}

function flowIndex(status: RiskItemStatus): number {
  return flow.indexOf(status)
}

function pad(value: number): string {
  return String(value).padStart(4, '0')
}

function levelCount(snap: OverviewSnapshot, level: RiskLevel): number {
  return snap.levelCounts.find((item) => item.level === level)?.count ?? 0
}

function cardValue(snap: OverviewSnapshot, label: string): number {
  return snap.cards.find((card) => card.label === label)?.value ?? 0
}

function switchOperator(event: Event) {
  store.setOperator((event.target as HTMLSelectElement).value)
}

function openCriteriaForm() {
  const rules = currentCriteria().rules
  criteriaForm.value = {
    note: '',
    firewatchScores: { ...rules.firewatchScores },
    patrolScores: { ...rules.patrolScores },
    fireteamScores: { ...rules.fireteamScores },
    thresholds: Object.fromEntries(
      rules.levelThresholds.map((item) => [item.level, item.minScore]),
    ) as Record<RiskLevel, number>,
  }
  showCriteria.value = !showCriteria.value
}

async function submit() {
  clearMessages()
  if (!submitForm.value.pointCode) {
    errorMessage.value = '请先选择要提交的监测点'
    return
  }
  const result = await submitRiskPoint({
    pointCode: submitForm.value.pointCode,
    source: submitForm.value.source,
    operator: store.operator,
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  notice.value = result.message
  submitForm.value.pointCode = ''
  reload()
}

async function confirm(id: number) {
  clearMessages()
  const result = await confirmDisposal(id, store.operator)
  result.ok ? (notice.value = result.message) : (errorMessage.value = result.message)
  reload()
}

async function complete(id: number) {
  clearMessages()
  const result = await completeDisposal(id)
  result.ok ? (notice.value = result.message) : (errorMessage.value = result.message)
  reload()
}

async function archive(id: number) {
  clearMessages()
  const result = await archiveRiskItem(id)
  result.ok ? (notice.value = result.message) : (errorMessage.value = result.message)
  reload()
}

async function saveCriteria() {
  clearMessages()
  const rules: RiskCriteriaRules = {
    firewatchScores: { ...criteriaForm.value.firewatchScores },
    patrolScores: { ...criteriaForm.value.patrolScores },
    fireteamScores: { ...criteriaForm.value.fireteamScores },
    levelThresholds: RISK_LEVELS.map((level) => ({
      level,
      minScore: criteriaForm.value.thresholds[level] ?? 0,
    })),
  }
  const result = await adjustCriteria(criteriaForm.value.note, rules)
  result.ok ? (notice.value = result.message) : (errorMessage.value = result.message)
  showCriteria.value = false
  reload()
}

async function snapshot() {
  clearMessages()
  const saved = await takeOverviewSnapshot(store.operator)
  notice.value = `已按 V${saved.criteriaVersion} 口径结转总览（${saved.takenAt}），此后口径调整不影响该记录`
  reload()
}

function clearMessages() {
  notice.value = ''
  errorMessage.value = ''
}

function reload() {
  board.value = loadBoard()
  riskItems.value = listRiskItems()
  snapshots.value = listSnapshots()
  sourceStats.value = sourceSummary()
  flowStats.value = statusSummary()
  points.value = listSubmittablePoints()
  criteria.value = currentCriteria()
}

onMounted(reload)
</script>
