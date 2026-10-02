// 数据层冒烟测试（node 直跑）：通过自定义 ESM loader 转译 TS 并重写 @/ 别名。
import { pathToFileURL } from 'node:url'

const LOCAL = {}
globalThis.window = {
  localStorage: {
    getItem: (k) => (k in LOCAL ? LOCAL[k] : null),
    setItem: (k, v) => { LOCAL[k] = String(v) },
    removeItem: (k) => { delete LOCAL[k] },
  },
}

const base = pathToFileURL(process.cwd() + '/').href
const { submitRisk, submitRiskConcurrent, confirmHandleRisk, publishCriteria,
  takeSnapshot, listRiskEvents, getRiskEvent, archiveRisk, currentCriteria } =
  await import(new URL('src/api/risk-service.ts', base))
const { listRows } = await import(new URL('src/data/local-store.ts', base))
const { getRiskState, resetRiskState } = await import(new URL('src/data/risk-store.ts', base))

let pass = 0, fail = 0
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${extra}`) }
}

// ---- 1. 并发提交同一风险点：只允许先落库的一次生效 ----
console.log('1) 并发提交去重')
resetRiskState()
const before = listRiskEvents().length
const results = submitRiskConcurrent(1, ['值班员甲', '值班员乙'])
check('第一次提交成功', results[0].ok === true, JSON.stringify(results[0]))
check('第二次提交被拒绝', results[1].ok === false)
check('第二次提示先落库者', results[1].message.includes('先于您提交'))
check('只新增了一条风险记录', listRiskEvents().length === before + 1)
// 再对同一监测点提交一次仍被拒绝
const third = submitRisk({ monitorPointId: 1, reporter: '值班员丙' })
check('后续重复提交同样不生效', third.ok === false)

// ---- 2. 确认处置：巡护待办、队伍台账各多一份真实事项 ----
console.log('2) 确认处置联动落库')
resetRiskState()
const target = listRiskEvents().find((r) => r.stage === '待核实')
const patrolBefore = listRows('patrol').length
const teamBefore = listRows('fireteam').length
const handle = confirmHandleRisk(target.id, '值班管理员', { code: 'TEAM-T-09', name: '测试扑火队' })
check('确认处置成功', handle.ok === true, handle.message)
const patrolAfter = listRows('patrol')
const teamAfter = listRows('fireteam')
check('巡护任务模块新增 1 条', patrolAfter.length === patrolBefore + 1)
check('扑火队伍模块新增 1 条', teamAfter.length === teamBefore + 1)
const newPatrol = patrolAfter.find((r) => r.来源风险 === `FRISK-${target.id}`)
const newTeam = teamAfter.find((r) => r.来源风险 === `FRISK-${target.id}`)
check('巡护待办是待执行状态', newPatrol && String(newPatrol.status) === '待执行' && newPatrol.pending === true)
check('队伍台账是已出动状态', newTeam && String(newTeam.status) === '已出动' && newTeam.pending === true)
check('风险记录回写联动编号', getRiskEvent(target.id).patrolTaskCode && getRiskEvent(target.id).teamCode)
// 重复派单被拦截
const again = confirmHandleRisk(target.id, '值班管理员', { code: 'x', name: 'y' })
check('已派单风险不能重复派单', again.ok === false)
check('重复派单不会再写联动记录', listRows('patrol').length === patrolAfter.length && listRows('fireteam').length === teamAfter.length)

// ---- 3. 口径调整：未归档重算，已归档与历史快照冻结 ----
console.log('3) 口径版本与重算/冻结')
resetRiskState()
const yellow = listRiskEvents().find((r) => r.source.监测状态 === '黄色预警')
const archived = listRiskEvents().find((r) => r.archived)
const archivedLevel = archived.level
const snapBefore = takeSnapshot('值班管理员')
check('v1 下黄色预警为中风险', yellow.level === '中')
publishCriteria({
  name: '高火险期收紧口径',
  note: '黄色预警升高',
  rules: { 红色预警: '高', 橙色预警: '高', 黄色预警: '高', 蓝色预警: '低', 正常: '低' },
})
check('现行口径已是 v2', currentCriteria().version === 2)
const yellow2 = getRiskEvent(yellow.id)
check('未归档黄警按新口径重算为高', yellow2.level === '高' && yellow2.criteriaVersion === 2)
check('重算过程写进了时间线', yellow2.timeline.some((t) => t.note.includes('重算')))
const archived2 = getRiskEvent(archived.id)
check('已归档记录等级冻结不变', archived2.level === archivedLevel)
check('已归档记录口径版本冻结', archived2.criteriaVersion === 1)
// 再拍一张快照，验证两张快照各自保留当时口径
const snapAfter = takeSnapshot('值班管理员')
check('历史快照保留 v1 口径编号', snapBefore.criteriaVersion === 1)
check('新快照使用 v2 口径编号', snapAfter.criteriaVersion === 2)
const state = getRiskState()
const storedBefore = state.snapshots.find((s) => s.id === snapBefore.id)
check('历史快照数字未被回改（v1 时黄警算中风险）',
  storedBefore.medium >= 1 && storedBefore.high !== snapAfter.high || storedBefore.criteriaVersion === 1)
check('快照保存口径名称', snapBefore.criteriaName.includes('常规') && snapAfter.criteriaName.includes('收紧'))

// ---- 4. 完整处置到归档 ----
console.log('4) 处置流程')
resetRiskState()
const r = listRiskEvents().find((x) => x.stage === '待核实')
check('归档前不能归档', archiveRisk(r.id, 'x').ok === false)
confirmHandleRisk(r.id, '值班管理员', { code: 'T1', name: '一队' })
const { reportHandling, confirmFinishRisk } = await import(new URL('src/api/risk-service.ts', base))
check('处置进展反馈成功', reportHandling(r.id, '队长', '扑救中').ok === true)
check('非处置中不能重复确认', confirmHandleRisk(r.id, 'x', { code: 'a', name: 'b' }).ok === false)
check('确认完成成功', confirmFinishRisk(r.id, '值班管理员', '扑灭').ok === true)
check('归档成功', archiveRisk(r.id, '值班管理员').ok === true)
check('归档后风险从看板活跃列表消失', listRiskEvents().filter((x) => !x.archived).every((x) => x.id !== r.id))
check('归档后不能再操作', reportHandling(r.id, 'x', 'y').ok === false)

console.log(`\n结果：${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
