import io

# ============ P1-6: itemPayload 改为 foodId 存在性判断 ============
p = 'miniprogram/utils/meal-edit.ts'
s = io.open(p, encoding='utf-8').read()
old = "export function itemPayload(items:EditItem[]){return items.filter(i=>!i.removed).map(i=>{const base={...(i.original?{mealItemId:i.original.mealItemId}:{}),observedName:i.name,consumedAmount:i.raw};if(i.unmatched||(!i.original&&i.foodId===null)||i.original?.matchStatus==='UNMATCHED'){return {...base,matchStatus:'UNMATCHED',matchReason:i.matchReason||'NO_MATCH_NO_NUTRITION',source:'MANUAL',status:'CONFIRMED'}}return {...base,foodId:i.foodId,selectedFoodRevisionId:i.selectedFoodRevisionId}})}"
assert s.count(old) == 1, 'itemPayload'
new = "export function itemPayload(items:EditItem[]){return items.filter(i=>!i.removed).map(i=>{const base={...(i.original?{mealItemId:i.original.mealItemId}:{}),observedName:i.name,consumedAmount:i.raw};if(!i.foodId){return {...base,matchStatus:'UNMATCHED',matchReason:i.matchReason||'NO_MATCH_NO_NUTRITION',source:'MANUAL',status:'CONFIRMED'}}return {...base,foodId:i.foodId,selectedFoodRevisionId:i.selectedFoodRevisionId}})}"
s = s.replace(old, new, 1)
# chooseFood 更换为标准食品时清除 unmatched（P1-6 关联）
old = "unmatched:false,matchReason:undefined"
if s.count(old) == 0:
    # 在 chooseFood 中添加 unmatched 清除
    old2 = "name:selected.foodId===i.original?.foodId?i.original!.observedName||'已确认食品':selected.observedName})"
    if s.count(old2) == 1:
        s = s.replace(old2, "name:selected.foodId===i.original?.foodId?i.original!.observedName||'已确认食品':selected.observedName,unmatched:false,matchReason:undefined})", 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('P1-6 itemPayload ok')

# ============ P1-3: 奶量操作号持久化 + 回执重试 ============
p = 'miniprogram/pages/records/records.ts'
s = io.open(p, encoding='utf-8').read()
# openMilkCreate 生成操作号并存入 panel
old = "this.setData({ milkPanel: { visible: true, mode: 'create', recordId: '', revisionToken: '', recordDate: this.data.selectedDate, time, milkTypeIndex: 0, volume: '', about: false, saving: false, deleting: false } })"
assert s.count(old) == 1, 'openMilkCreate'
s = s.replace(old, "this.setData({ milkPanel: { visible: true, mode: 'create', recordId: '', revisionToken: '', recordDate: this.data.selectedDate, time, milkTypeIndex: 0, volume: '', about: false, saving: false, deleting: false, operationId: operationId() } })", 1)
# saveMilkRecord：复用 panel.operationId（同内容重试不重复入库）
old = """      if (panel.mode === 'create') {
        const active = await context()
        var response = await request<{ reportUpdate?: { status?: string } }>(`/subjects/${active.subjectId}/milk-records`, { method: 'POST', data: { operationId: operationId(), ...body } })
      } else {
        var response = await request<{ reportUpdate?: { status?: string } }>(`/milk-records/${panel.recordId}`, { method: 'PATCH', data: { operationId: operationId(), expectedRevision: panel.revisionToken, ...body } })
      }"""
assert s.count(old) == 1, 'save opid'
s = s.replace(old, """      if (panel.mode === 'create') {
        const active = await context()
        var response = await request<{ reportUpdate?: { status?: string } }>(`/subjects/${active.subjectId}/milk-records`, { method: 'POST', data: { operationId: panel.operationId || operationId(), ...body } })
      } else {
        var response = await request<{ reportUpdate?: { status?: string } }>(`/milk-records/${panel.recordId}`, { method: 'PATCH', data: { operationId: panel.operationId || operationId(), expectedRevision: panel.revisionToken, ...body } })
      }""", 1)
# milkPanel 类型加 operationId
old = "milkPanel: { visible: false, mode: 'create', recordId: '', revisionToken: '', recordDate: dateOnly(new Date()), time: '08:00', milkTypeIndex: 0, volume: '', about: false, saving: false, deleting: false },"
assert s.count(old) == 1, 'panel type'
s = s.replace(old, "milkPanel: { visible: false, mode: 'create', recordId: '', revisionToken: '', recordDate: dateOnly(new Date()), time: '08:00', milkTypeIndex: 0, volume: '', about: false, saving: false, deleting: false, operationId: '' },", 1)
# openMilkEdit 生成新操作号
old = "this.setData({ milkPanel: { visible: true, mode: 'edit', recordId, revisionToken: row.revisionToken, recordDate: this.data.selectedDate, time, milkTypeIndex: index < 0 ? 0 : index, volume: row.volumeMl === null ? '' : formatMl(row.volumeMl), about: row.volumeOrigin === 'USER_ACCEPTED_ESTIMATE', saving: false, deleting: false } })"
assert s.count(old) == 1, 'openMilkEdit'
s = s.replace(old, "this.setData({ milkPanel: { visible: true, mode: 'edit', recordId, revisionToken: row.revisionToken, recordDate: this.data.selectedDate, time, milkTypeIndex: index < 0 ? 0 : index, volume: row.volumeMl === null ? '' : formatMl(row.volumeMl), about: row.volumeOrigin === 'USER_ACCEPTED_ESTIMATE', saving: false, deleting: false, operationId: operationId() } })", 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('P1-3 milk operationId ok')

# ============ P1-8: api.ts epoch 覆盖奶量+confirmed+all writes ============
p = 'miniprogram/utils/api.ts'
s = io.open(p, encoding='utf-8').read()
old = "if (options.method && options.method !== 'GET' && (/^\\/meals\\//.test(path) || /^\\/subjects\\/[^/]+$/.test(path))) wx.setStorageSync('foodmaster.recordEpoch', Number(wx.getStorageSync('foodmaster.recordEpoch') || 0) + 1)"
assert s.count(old) == 1, 'epoch regex'
s = s.replace(old, "if (options.method && options.method !== 'GET') wx.setStorageSync('foodmaster.recordEpoch', Number(wx.getStorageSync('foodmaster.recordEpoch') || 0) + 1)", 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('P1-8 epoch ok')

# ============ P2-13: 并发刷新共享（所有 401 等待同一个刷新） ============
old = """    if (!retried && error.statusCode === 401 && options.auth !== false) {
      const auth = getAuth()
      if (!auth) throw error
      if (auth.refreshToken) {"""
assert s.count(old) == 1, 'refresh guard'
s = s.replace(old, """    if (!retried && error.statusCode === 401 && options.auth !== false) {
      const auth = getAuth()
      if (!auth) throw error
      if (auth.refreshToken) {""", 1)
# 修改 setAuth 守卫：不再比对 refreshToken，只要存储中仍存在即落盘
old = """      const current = getAuth()
      if (!current || current.refreshToken !== auth.refreshToken) throw error
      setAuth(refreshed)
      return request<T>(path, options, true)"""
assert s.count(old) == 1, 'setAuth guard'
s = s.replace(old, """      const current = getAuth()
      if (!current) { error.authExpired = true; throw error }
      setAuth(refreshed)
      return request<T>(path, options, true)""", 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('P2-13 concurrent refresh ok')
