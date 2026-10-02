<template>
  <section class="risk-board">
    <header class="page-head">
      <div>
        <h2>火险态势视图</h2>
        <p class="page-desc">
          火险监测点、巡护任务与扑火队伍按高 / 中 / 低风险排成看板；同卡展示风险来源与处置进度。
          当前执行：{{ criteria.name }}（v{{ criteria.version }}，{{ criteria.changedAt }}）
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="showCriteria = !showCriteria">
          {{ showCriteria ? '收起口径与历史' : '风险口径与总览历史' }}
        </button>
        <button class="btn" type="button" @click="reload">刷新态势</button>
      </div>
    </header>

    <!-- 提交区：含双值班员并发提交演示 -->
    <div class="submit-panel">
      <div class="submit-form">
        <label class="filter-item">
          <span>风险监测点</span>
          <select v-model="form.monitorPointId">
            <option value="">请选择火险监测点</option>
            <option v-for="opt in pointOptions" :key="opt.id" :value="opt.id">
              {{ opt.label }}｜{{ opt.status }}
            </option>
          </select>
        </label>
        <label class="filter-item">
          <span>提交值班员</span>
          <input v-model="form.reporter" placeholder="值班员姓名" />
        </label>
        <label class="filter-item submit-note">
          <span>情况说明</span>
          <input v-model="form.note" placeholder="选填" />
        </label>
        <button class="btn primary" type="button" @click="doSubmit">提交风险点</button>
        <button class="btn" type="button" @click="doConcurrent">
          模拟甲、乙两名值班员并发提交同一风险点
        </button>
      </div>
      <p v-if="submitMessage" :class="['submit-msg', submitOk ? 'ok-text' : 'error-text']">
        {{ submitMessage }}
      </p>
    </div>

    <div class="stat-row">
      <article class="stat-card"><span class="stat-label">未归档风险点</span><strong class="stat-value">{{ board.activeCount }}</strong></article>
      <article class="stat-card"><span class="stat-label">待核实（待派单）</span><strong class="stat-value">{{ board.pendingCount }}</strong></article>
      <article class="stat-card risk-high-text"><span class="stat-label">高风险</span><strong class="stat-value">{{ board.lanes[0].risks.length }}</strong></article>
      <article class="stat-card risk-mid-text"><span class="stat-label">中风险</span><strong class="stat-value">{{ board.lanes[1].risks.length }}</strong></article>
      <article class="stat-card risk-low-text"><span class="stat-label">低风险</span><strong class="stat-value">{{ board.lanes[2].risks.length }}</strong></article>
      <article class="stat-card"><span class="stat-label">已归档（口径冻结）</span><strong class="stat-value">{{ board.archivedCount }}</strong></article>
    </div>

    <!-- 看板：三列风险 -->
    <div class="kanban">
      <div v-for="lane in board.lanes" :key="lane.level" :class="['kanban-col', `risk-${lane.level}`]">
        <header class="kanban-head">
          <strong>{{ lane.level }}风险</strong>
          <span class="kanban-count">{{ lane.risks.length }}</span>
        </header>
        <article v-for="risk in lane.risks" :key="risk.id" class="risk-card">
          <header class="risk-card-head">
            <span class="risk-code">FRISK-{{ risk.id }}</span>
            <span :class="['risk-badge', `badge-${risk.level}`]">{{ risk.level }}</span>
            <span class="risk-stage">{{ risk.stage }}</span>
          </header>

          <!-- 风险来源：监测点快照 -->
          <div class="risk-source">
            <h4>风险来源 · {{ risk.source.监测点编号 }}</h4>
            <dl>
              <dt>监测区域</dt><dd>{{ risk.source.监测区域 }}</dd>
              <dt>监测状态</dt><dd>{{ risk.source.监测状态 }}</dd>
              <dt>火险等级</dt><dd>{{ risk.source.火险等级 }}</dd>
              <dt>风力 / 湿度</dt><dd>{{ risk.source.风力等级 }} / {{ risk.source.相对湿度 }}</dd>
              <dt>气温</dt><dd>{{ risk.source.气温读数 }}</dd>
              <dt>监测时间</dt><dd>{{ risk.source.监测时间 }}</dd>
            </dl>
            <p class="risk-meta">上报：{{ risk.reporter }} · {{ risk.createdAt }} · 口径 v{{ risk.criteriaVersion }}</p>
          </div>

          <!-- 处置进度 -->
          <div class="risk-progress">
            <div class="progress-track">
              <div v-for="s in stages" :key="s" :class="['progress-step', { on: stageIndex(risk.stage) >= stageIndex(s) }]">
                <span class="dot"></span><span class="step-label">{{ s }}</span>
              </div>
            </div>
            <div class="linked-items">
              <p>
                巡护待办：
                <RouterLink v-if="risk.patrolTaskCode" to="/patrol" class="link">{{ risk.patrolTaskCode }}</RouterLink>
                <em v-else>尚未派单</em>
              </p>
              <p>
                队伍台账：
                <RouterLink v-if="risk.teamCode" to="/fireteam" class="link">{{ risk.teamCode }}</RouterLink>
                <em v-else>尚未出动</em>
                <span v-if="risk.teamName">（{{ risk.teamName }}）</span>
              </p>
            </div>
            <ul class="timeline">
              <li v-for="(item, i) in risk.timeline" :key="i">
                <span class="tl-time">{{ item.time }}</span>
                <span class="tl-stage">{{ item.stage }}</span>
                <span class="tl-text">{{ item.note }}（{{ item.operator }}）</span>
              </li>
            </ul>
          </div>

          <!-- 处置动作 -->
          <div class="risk-actions">
            <template v-if="risk.stage === '待核实'">
              <select v-model="dispatchChoice[risk.id]">
                <option value="">选择出动队伍</option>
                <option v-for="t in teams" :key="t.code" :value="`${t.code}|${t.name}`">
                  {{ t.name }}（{{ t.code }}）
                </option>
                <option value="custom|现场就近半专业扑火队">现场就近半专业扑火队</option>
              </select>
              <button class="btn primary" type="button" @click="doConfirmHandle(risk)">确认处置并派单</button>
            </template>
            <template v-else-if="risk.stage === '已派单'">
              <button class="btn" type="button" @click="doReport(risk)">反馈处置进展</button>
            </template>
            <template v-else-if="risk.stage === '处置中'">
              <button class="btn primary" type="button" @click="doFinish(risk)">值班员确认处置完成</button>
            </template>
            <template v-else-if="risk.stage === '已确认'">
              <button class="btn" type="button" @click="doArchive(risk)">归档备查</button>
            </template>
          </div>
        </article>
        <p v-if="!lane.risks.length" class="kanban-empty">暂无{{ lane.level }}风险</p>
      </div>
    </div>

    <!-- 已归档记录：历史口径冻结展示 -->
    <section class="archive-panel">
      <h3>已归档风险记录（按归档时口径保留，不参与重算）</h3>
      <table v-if="archivedRisks.length" class="data-table">
        <thead>
          <tr><th>风险编号</th><th>风险来源</th><th>归档等级</th><th>归档口径</th><th>当前口径下对照</th><th>上报人</th><th>归档时间</th></tr>
        </thead>
        <tbody>
          <tr v-for="risk in archivedRisks" :key="risk.id">
            <td>FRISK-{{ risk.id }}</td>
            <td>{{ risk.source.监测点编号 }}｜{{ risk.source.监测区域 }}（{{ risk.source.监测状态 }}）</td>
            <td><span :class="['risk-badge', `badge-${risk.level}`]">{{ risk.level }}</span></td>
            <td>v{{ risk.criteriaVersion }}</td>
            <td>
              <span :class="currentLevel(risk) === risk.level ? 'ok-text' : 'warn-text'">
                当前口径 v{{ criteria.version }} 下为「{{ currentLevel(risk) }}」，历史记录仍显示「{{ risk.level }}」
              </span>
            </td>
            <td>{{ risk.reporter }}</td>
            <td>{{ risk.updatedAt }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty-state">暂无已归档记录</p>
    </section>

    <!-- 口径版本与总览历史 -->
    <section v-if="showCriteria" class="criteria-panel">
      <div class="criteria-col">
        <h3>风险口径版本</h3>
        <table class="data-table">
          <thead><tr><th>版本</th><th>名称</th><th>生效时间</th><th>说明</th></tr></thead>
          <tbody>
            <tr v-for="c in criteriaList" :key="c.version" :class="{ 'criteria-current': c.version === criteria.version }">
              <td>v{{ c.version }}{{ c.version === criteria.version ? '（现行）' : '' }}</td>
              <td>{{ c.name }}</td>
              <td>{{ c.changedAt }}</td>
              <td>{{ c.note }}</td>
            </tr>
          </tbody>
        </table>
        <div class="criteria-adjust">
          <p class="page-desc">调整后：未归档记录立即按新口径重算；已归档记录与下方历史总览保持原口径。</p>
          <div class="filter-bar">
            <label class="filter-item"><span>口径名称</span><input v-model="newCriteria.name" placeholder="如：高火险期收紧口径" /></label>
            <label class="filter-item" v-for="status in monitorStatuses" :key="status">
              <span>{{ status }} →</span>
              <select v-model="newCriteria.rules[status]">
                <option value="高">高</option><option value="中">中</option><option value="低">低</option>
              </select>
            </label>
            <label class="filter-item submit-note"><span>调整说明</span><input v-model="newCriteria.note" /></label>
            <button class="btn primary" type="button" @click="doPublishCriteria">发布新口径并重算</button>
            <button class="btn" type="button" @click="fillTightPreset">填入「黄色预警升高」预设</button>
          </div>
        </div>
      </div>

      <div class="criteria-col">
        <h3>运营总览历史快照</h3>
        <p class="page-desc">
          <button class="btn primary" type="button" @click="doTakeSnapshot">生成当前总览快照</button>
          快照按当时口径冻结数字，之后口径调整不回改。
        </p>
        <table v-if="snapshots.length" class="data-table">
          <thead>
            <tr><th>生成时间</th><th>值班员</th><th>口径</th><th>高/中/低</th><th>未归档</th><th>已归档</th><th>待核实</th></tr>
          </thead>
          <tbody>
            <tr v-for="s in snapshots" :key="s.id">
              <td>{{ s.takenAt }}</td>
              <td>{{ s.operator }}</td>
              <td>{{ s.criteriaName }} v{{ s.criteriaVersion }}</td>
              <td>{{ s.high }} / {{ s.medium }} / {{ s.low }}</td>
              <td>{{ s.active }}</td>
              <td>{{ s.archived }}</td>
              <td>{{ s.pendingDisposal }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty-state">尚未生成历史快照</p>
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'

import {
  archiveRisk,
  confirmFinishRisk,
  confirmHandleRisk,
  currentCriteria,
  dispatchableTeams,
  listCriteria,
  listRiskEvents,
  listSnapshots,
  loadRiskBoard,
  monitorPointOptions,
  publishCriteria,
  reportHandling,
  submitRisk,
  submitRiskConcurrent,
  takeSnapshot,
} from '@/api/risk-service'
import type { OverviewSnapshot, RiskCriteria, RiskEvent, RiskLevel, RiskStage } from '@/data/risk-types'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const stages: RiskStage[] = ['待核实', '已派单', '处置中', '已确认', '已归档']
const monitorStatuses = ['红色预警', '橙色预警', '黄色预警', '蓝色预警', '正常']

const board = ref(loadRiskBoard())
const pointOptions = ref(monitorPointOptions())
const teams = ref(dispatchableTeams())
const criteriaList = ref<RiskCriteria[]>(listCriteria())
const criteria = ref<RiskCriteria>(currentCriteria())
const snapshots = ref<OverviewSnapshot[]>(listSnapshots())
const archivedRisks = ref<RiskEvent[]>([])
const showCriteria = ref(false)
const dispatchChoice = reactive<Record<number, string>>({})

const form = reactive({ monitorPointId: '' as number | '', reporter: session.operator, note: '' })
const submitMessage = ref('')
const submitOk = ref(true)

const newCriteria = reactive({
  name: '',
  note: '',
  rules: {} as Record<string, RiskLevel>,
})

function stageIndex(stage: RiskStage): number {
  return stages.indexOf(stage)
}

function currentLevel(risk: RiskEvent): RiskLevel {
  return criteria.value.statusLevelRules[risk.source.监测状态] ?? risk.level
}

function flash(ok: boolean, message: string) {
  submitOk.value = ok
  submitMessage.value = message
}

function reload() {
  board.value = loadRiskBoard()
  pointOptions.value = monitorPointOptions()
  teams.value = dispatchableTeams()
  criteriaList.value = listCriteria()
  criteria.value = currentCriteria()
  snapshots.value = listSnapshots()
  archivedRisks.value = listRiskEvents().filter((risk) => risk.archived)
}

function doSubmit() {
  if (!form.monitorPointId) {
    flash(false, '请先选择风险监测点')
    return
  }
  const result = submitRisk({
    monitorPointId: Number(form.monitorPointId),
    reporter: form.reporter.trim() || '匿名值班员',
    note: form.note,
  })
  flash(result.ok, result.message)
  if (result.ok) {
    form.monitorPointId = ''
    form.note = ''
    reload()
  }
}

// 并发演示：同一批次内两名值班员提交同一监测点，验证只有先落库的一次生效
function doConcurrent() {
  if (!form.monitorPointId) {
    flash(false, '请先选择要并发提交的风险监测点')
    return
  }
  const results = submitRiskConcurrent(Number(form.monitorPointId), ['值班员甲', '值班员乙'])
  const lines = results.map(
    (result, index) => `${index === 0 ? '值班员甲（先提交）' : '值班员乙（后提交）'}：${result.message}`,
  )
  flash(results.filter((r) => r.ok).length === 1, lines.join(' ｜ '))
  form.monitorPointId = ''
  reload()
}

function doConfirmHandle(risk: RiskEvent) {
  const choice = dispatchChoice[risk.id]
  if (!choice) {
    flash(false, `FRISK-${risk.id}：请先选择出动队伍`)
    return
  }
  const [code, name] = choice.split('|')
  const result = confirmHandleRisk(risk.id, session.operator, { code, name })
  flash(result.ok, result.message)
  reload()
}

function doReport(risk: RiskEvent) {
  const result = reportHandling(risk.id, session.operator, '队伍已抵达现场，正在处置')
  flash(result.ok, result.message)
  reload()
}

function doFinish(risk: RiskEvent) {
  const result = confirmFinishRisk(risk.id, session.operator, '明火已扑灭，现场清理完毕')
  flash(result.ok, result.message)
  reload()
}

function doArchive(risk: RiskEvent) {
  const result = archiveRisk(risk.id, session.operator)
  flash(result.ok, result.message)
  reload()
}

function fillTightPreset() {
  newCriteria.name = '高火险期收紧口径'
  newCriteria.note = '黄色预警由中风险上调为高风险，其余不变'
  newCriteria.rules = {
    红色预警: '高',
    橙色预警: '高',
    黄色预警: '高',
    蓝色预警: '低',
    正常: '低',
  }
}

function doPublishCriteria() {
  const rules = { ...criteria.value.statusLevelRules, ...newCriteria.rules }
  publishCriteria({ name: newCriteria.name, note: newCriteria.note, rules })
  newCriteria.name = ''
  newCriteria.note = ''
  newCriteria.rules = {}
  flash(true, '新口径已发布，未归档记录已按新口径重算；归档记录保持原口径')
  reload()
}

function doTakeSnapshot() {
  const snapshot = takeSnapshot(session.operator)
  flash(true, `已生成 ${snapshot.takenAt} 的总览快照（按 v${snapshot.criteriaVersion} 冻结）`)
  reload()
}

onMounted(reload)
</script>

<style scoped>
.submit-panel { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; }
.submit-form { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; }
.submit-note { flex: 1; min-width: 200px; }
.submit-msg { margin: 8px 0 0; font-size: 13px; }
.ok-text { color: #067647; }
.warn-text { color: #b54708; }
.risk-high-text .stat-value { color: #b42318; }
.risk-mid-text .stat-value { color: #b54708; }
.risk-low-text .stat-value { color: #067647; }

.kanban { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; align-items: start; }
.kanban-col { border-radius: 8px; padding: 10px; min-height: 240px; background: #eef2f7; }
.kanban-col.risk-高 { background: #fef3f2; }
.kanban-col.risk-中 { background: #fffaeb; }
.kanban-col.risk-低 { background: #ecfdf3; }
.kanban-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.kanban-count { background: rgba(0,0,0,.08); border-radius: 999px; padding: 0 8px; font-size: 12px; }
.kanban-empty { font-size: 12px; color: var(--muted); text-align: center; }

.risk-card { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 10px; margin-bottom: 10px; }
.risk-card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.risk-code { font-weight: 600; font-size: 13px; }
.risk-stage { margin-left: auto; font-size: 12px; color: var(--muted); }
.risk-badge { border-radius: 4px; padding: 1px 8px; font-size: 12px; color: #fff; }
.badge-高 { background: #d92d20; }
.badge-中 { background: #dc6803; }
.badge-低 { background: #039855; }

.risk-source { border-left: 3px solid var(--brand); padding-left: 8px; margin-bottom: 8px; }
.risk-source h4 { margin: 0 0 4px; font-size: 13px; }
.risk-source dl { display: grid; grid-template-columns: 1fr 1.6fr; gap: 2px 8px; margin: 0; font-size: 12px; }
.risk-source dt { color: var(--muted); }
.risk-source dd { margin: 0; }
.risk-meta { margin: 4px 0 0; font-size: 11px; color: var(--muted); }

.risk-progress { margin-bottom: 8px; }
.progress-track { display: flex; justify-content: space-between; position: relative; margin: 6px 0 8px; }
.progress-track::before { content: ''; position: absolute; top: 5px; left: 8%; right: 8%; height: 2px; background: #d8dee6; }
.progress-step { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; z-index: 1; }
.progress-step .dot { width: 10px; height: 10px; border-radius: 50%; background: #cbd5e1; }
.progress-step.on .dot { background: var(--brand); }
.step-label { font-size: 10px; color: var(--muted); }
.linked-items { font-size: 12px; margin-bottom: 6px; }
.linked-items p { margin: 2px 0; }
.linked-items em { color: var(--muted); font-style: normal; }
.timeline { list-style: none; margin: 0; padding: 0; border-top: 1px dashed var(--border); }
.timeline li { font-size: 11px; color: var(--muted); padding: 3px 0 3px 4px; border-left: 2px solid #cbd5e1; margin-left: 4px; }
.tl-time { margin-right: 6px; }
.tl-stage { color: #1f2937; margin-right: 6px; }

.risk-actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.risk-actions select { padding: 4px 6px; font-size: 12px; }

.archive-panel, .criteria-panel { margin-top: 16px; }
.archive-panel h3, .criteria-panel h3 { font-size: 14px; margin: 0 0 8px; }
.criteria-panel { display: grid; grid-template-columns: 1.2fr 1fr; gap: 12px; align-items: start; }
.criteria-col { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; }
.criteria-current { background: #eff8ff; }
.criteria-adjust { margin-top: 10px; border-top: 1px dashed var(--border); padding-top: 8px; }
</style>
