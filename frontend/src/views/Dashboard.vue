<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标；火险态势视图按风险排列监测点、巡护任务与扑火队伍。</p>
      </div>
      <div class="page-actions">
        <div class="tabs">
          <button :class="['tab', { active: tab === 'overview' }]" type="button" @click="tab = 'overview'">指标总览</button>
          <button :class="['tab', { active: tab === 'risk' }]" type="button" @click="switchRisk">火险态势视图</button>
        </div>
        <button v-if="tab === 'overview'" class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>

    <template v-if="tab === 'overview'">
      <div class="stat-row">
        <article v-for="card in cards" :key="card.label" class="stat-card">
          <span class="stat-label">{{ card.label }}</span>
          <strong class="stat-value">{{ card.value }}</strong>
        </article>
      </div>
      <table class="data-table">
        <thead>
          <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
        </thead>
        <tbody>
          <tr v-for="row in moduleRows" :key="row.name">
            <td>{{ row.name }}</td>
            <td>{{ row.created }}</td>
            <td>{{ row.pending }}</td>
            <td>{{ row.abnormal }}</td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot">
        <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
        <button class="link" type="button" @click="resetAll">重置本页示例数据</button>
      </footer>
    </template>

    <RiskBoard v-else />
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { loadOverview, resetModule } from '@/api/local-service'
import { resetRiskState } from '@/data/risk-store'
import type { OverviewResult } from '@/data/types'
import RiskBoard from '@/views/riskboard/index.vue'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const route = useRoute()
const tab = ref<'overview' | 'risk'>(route.query.tab === 'risk' ? 'risk' : 'overview')

watch(
  () => route.query.tab,
  (value) => {
    tab.value = value === 'risk' ? 'risk' : 'overview'
  },
)

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
}

function switchRisk() {
  tab.value = 'risk'
}

function resetAll() {
  resetModule('patrol')
  resetModule('fireteam')
  resetRiskState()
  refresh()
}

onMounted(refresh)
</script>

<style scoped>
.tabs { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; margin-right: 8px; }
.tab { border: none; background: #fff; padding: 6px 14px; cursor: pointer; font-size: 13px; }
.tab.active { background: var(--brand); color: #fff; }
</style>
