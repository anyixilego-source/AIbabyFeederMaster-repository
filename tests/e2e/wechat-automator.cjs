const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const automator = require('miniprogram-automator')

const projectPath = path.resolve(__dirname, '..', '..')
const cliPath = process.env.WECHAT_DEVTOOLS_CLI || 'D:\\application\\Tencent\\微信web开发者工具\\cli.bat'
const port = Number(process.env.WECHAT_AUTOMATION_PORT || 9420)
const outputDir = process.env.WECHAT_E2E_OUTPUT
  ? path.resolve(process.env.WECHAT_E2E_OUTPUT)
  : path.join(projectPath, 'artifacts', 'wechat-e2e')

const routes = [
  ['home', '/pages/index/index'],
  ['profile', '/pages/profile/profile'],
  ['camera', '/pages/camera/camera'],
  ['records', '/pages/records/records'],
]

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function connect() {
  const endpoint = `ws://127.0.0.1:${port}`
  try {
    return await automator.connect({ wsEndpoint: endpoint })
  } catch (_) {
    const command = `"${cliPath}" auto --project "${projectPath}" --auto-port ${port} --trust-project --lang zh`
    const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
      stdio: 'inherit',
    })
    if (result.status !== 0) {
      throw new Error(`微信开发者工具自动化入口启动失败，退出码 ${result.status}`)
    }
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await delay(500)
      try {
        return await automator.connect({ wsEndpoint: endpoint })
      } catch (_) {
        // 等待开发者工具完成编译并开放自动化端口。
      }
    }
    throw new Error(`无法连接微信开发者工具自动化端口 ${port}`)
  }
}

function screenshotPath(name) {
  fs.mkdirSync(outputDir, { recursive: true })
  return path.join(outputDir, `${name}.png`)
}

async function capture(miniProgram, route, name) {
  const page = await miniProgram.reLaunch(route)
  await page.waitFor(1200)
  const target = screenshotPath(name)
  await miniProgram.screenshot({ path: target })
  return { name, route: page.path, screenshot: target }
}

async function main() {
  const command = process.argv[2] || 'inspect'
  const miniProgram = await connect()
  try {
    if (command === 'inspect') {
      const page = await miniProgram.currentPage()
      const info = await miniProgram.systemInfo()
      const target = screenshotPath('current')
      await miniProgram.screenshot({ path: target })
      console.log(JSON.stringify({
        route: page && page.path,
        screen: `${info.screenWidth}x${info.screenHeight}`,
        platform: info.platform,
        screenshot: target,
      }))
      return
    }

    if (command === 'capture') {
      const route = process.argv[3] || '/pages/index/index'
      const name = process.argv[4] || route.split('/').filter(Boolean).pop() || 'page'
      console.log(JSON.stringify(await capture(miniProgram, route, name)))
      return
    }

    if (command === 'smoke') {
      const results = []
      for (const [name, route] of routes) {
        results.push(await capture(miniProgram, route, name))
      }
      console.log(JSON.stringify(results))
      return
    }

    if (command === 'report') {
      const report = await miniProgram.reLaunch('/pages/report/report')
      await report.waitFor(2500)
      if (process.argv[3] === 'force') {
        await report.callMethod('loadReport', true)
        await report.waitFor(2500)
      }
      const data = await report.data()
      const target = screenshotPath('report-current')
      await miniProgram.screenshot({ path: target })
      console.log(JSON.stringify({
        errorMessage: data.errorMessage,
        mealCount: data.mealCount,
        foodCount: data.foodCount,
        allNutrientCount: data.allNutrients.length,
        visibleNutrientCount: data.nutrients.length,
        selectedCategory: data.selectedCategory,
        screenshot: target,
      }))
      return
    }

    if (command === 'overview') {
      const overview = await miniProgram.reLaunch('/pages/report-overview/report-overview')
      await overview.waitFor(2500)
      const data = await overview.data()
      const target = screenshotPath('report-overview-current')
      await miniProgram.screenshot({ path: target })
      console.log(JSON.stringify({
        errorMessage: data.errorMessage,
        trendOptionCount: data.trendOptions.length,
        selectedTrend: data.selectedTrend,
        referenceAvailable: data.referenceAvailable,
        referenceLabel: data.referenceLabel,
        screenshot: target,
      }))
      return
    }

    if (command === 'flow') {
      await miniProgram.callWxMethod('removeStorageSync', 'foodmaster.currentMealId')

      const camera = await miniProgram.reLaunch('/pages/camera/camera')
      await camera.waitFor(1500)
      const mealIdAfterCameraEntry = await miniProgram.callWxMethod('getStorageSync', 'foodmaster.currentMealId')
      assert.equal(mealIdAfterCameraEntry, '', '进入拍照页不应提前创建餐食草稿')

      const profile = await miniProgram.reLaunch('/pages/profile/profile')
      await profile.waitFor(1500)
      const editButton = await profile.$('.edit-button')
      assert.ok(editButton, '档案页应存在编辑入口')
      await editButton.tap()
      await profile.waitFor(300)
      assert.ok(await profile.$('.edit-sheet'), '点击编辑后应打开档案编辑面板')
      await profile.callMethod('closeEdit')
      await delay(300)

      const menuEntry = await profile.$('.menu-entry')
      assert.ok(menuEntry, '档案页应提供家庭食谱入口')
      await miniProgram.navigateTo('/pages/menu/menu')
      await delay(800)
      const menu = await miniProgram.currentPage()
      assert.equal(menu.path, 'pages/menu/menu', '家庭食谱入口应打开菜单页')
      await menu.callMethod('goBack')
      await delay(1200)
      const returnedProfile = await miniProgram.currentPage()
      assert.equal(returnedProfile.path, 'pages/profile/profile', '菜单页返回后应回到档案页')
      const profileForAbout = await miniProgram.reLaunch('/pages/profile/profile')
      await profileForAbout.waitFor(1200)
      const aboutEntry = await profileForAbout.$('.about-entry')
      assert.ok(aboutEntry, '档案页应提供关于与合规入口')
      await miniProgram.navigateTo('/pages/about/about')
      await delay(800)
      const about = await miniProgram.currentPage()
      assert.equal(about.path, 'pages/about/about', '关于与合规入口应打开备案页')
      await about.callMethod('goBack')
      await delay(400)
      assert.equal((await miniProgram.currentPage()).path, 'pages/profile/profile', '备案页返回后应回到档案页')

      const result = await miniProgram.reLaunch('/pages/result/result')
      await result.waitFor(800)
      const manualButton = await result.$('.secondary-button')
      assert.ok(manualButton, '识别结果页应存在手工添加入口')
      await manualButton.tap()
      await result.waitFor(300)
      const resultData = await result.data()
      assert.equal(resultData.scrollIntoView, 'confirm-section', '手工添加应定位到食品确认区')
      assert.equal(resultData.manualFocus, true, '手工添加应聚焦食品搜索输入框')

      await miniProgram.reLaunch('/pages/index/index')
      console.log(JSON.stringify({
        cameraEntryCreatesDraft: false,
        profileEditorOpens: true,
        profileSecondaryNavigationWorks: true,
        manualSearchFocuses: true,
      }))
      return
    }

    if (command === 'fixture') {
      await miniProgram.callWxMethod('removeStorageSync', 'foodmaster.currentMealId')
      await miniProgram.callWxMethod('removeStorageSync', 'mealPhoto')
      const camera = await miniProgram.reLaunch('/pages/camera/camera')
      await camera.waitFor(800)
      const photoPath = await miniProgram.evaluate(() => {
        const target = `${wx.env.USER_DATA_PATH}/foodmaster-e2e-meal.jpg`
        const fileSystem = wx.getFileSystemManager()
        try { fileSystem.unlinkSync(target) } catch (_) {}
        fileSystem.copyFileSync('assets/camera-food-guide-v5.jpg', target)
        return target
      })
      await camera.callMethod('continueWithPhoto', photoPath)
      await camera.waitFor(2500)
      const result = await miniProgram.currentPage()
      assert.equal(result.path, 'pages/result/result', '本地图片准备完成后应进入识别结果页')
      assert.ok(await result.$('.consent-link'), '授权区应提供可按需查看的图片处理说明')
      let consentData = await result.data()
      assert.equal(consentData.accepted, false, '初次进入时不应默认授权')
      await result.callMethod('onConsentPrimaryAction')
      consentData = await result.data()
      assert.equal(consentData.accepted, true, '首次点击主按钮应自动勾选授权，但不立即发起识别')
      assert.equal(consentData.result, null, '同意授权与开始识别应为两次明确操作')
      const target = screenshotPath('result-fixture')
      await miniProgram.screenshot({ path: target })
      const resultData = await result.data()
      const firstMealId = await miniProgram.callWxMethod('getStorageSync', 'foodmaster.currentMealId')
      await result.callMethod('retry')
      await delay(500)
      const retakeCamera = await miniProgram.currentPage()
      assert.equal(retakeCamera.path, 'pages/camera/camera', '重拍应返回拍照页')
      await retakeCamera.callMethod('continueWithPhoto', photoPath)
      let retakeResult = await miniProgram.currentPage()
      for (let attempt = 0; attempt < 10 && retakeResult.path !== 'pages/result/result'; attempt += 1) {
        await delay(500)
        retakeResult = await miniProgram.currentPage()
      }
      assert.equal(retakeResult.path, 'pages/result/result', '重拍重新选图后应回到识别结果页')
      const secondMealId = await miniProgram.callWxMethod('getStorageSync', 'foodmaster.currentMealId')
      assert.equal(secondMealId, firstMealId, '同一次重拍应复用当前餐食草稿')
      console.log(JSON.stringify({
        route: retakeResult.path,
        samplePhoto: resultData.samplePhoto,
        hasMealDraft: !!secondMealId,
        retakeReusedDraft: true,
        screenshot: target,
      }))
      return
    }

    if (command === 'candidate') {
      const result = await miniProgram.currentPage()
      assert.equal(result.path, 'pages/result/result', '候选映射检查必须从识别结果页开始')
      const candidate = {
        observedName: '米饭', form: '煮', count: 1, amountHint: null, confidence: 0.9,
        uncertainties: ['无法从图片确定实际摄入克数'],
      }
      await result.setData({
        accepted: true,
        result: { mode: 'AI_CANDIDATES', items: [candidate] },
        foods: [{
          badge: '米', name: '米饭', details: '煮 · 1份 · 份量待确认 · 置信度 90%',
          uncertainty: '', tone: 'vegetable', index: 0, mappedName: '',
        }],
        confirmedFoods: [],
        mealTotalAmount: '200',
        ratioTotal: 0,
        ratioAdjustmentSequence: 0,
        errorMessage: '',
      })
      await result.callMethod('autoMapCandidates', [candidate])
      let data
      for (let attempt = 0; attempt < 12; attempt += 1) {
        data = await result.data()
        if (data.confirmedFoods.length && data.foods[0].mappedName) break
        await delay(500)
      }
      data = await result.data()
      assert.equal(data.confirmedFoods.length, 1, '可查到的候选应自动映射首个标准食品')
      assert.ok(data.foods[0].mappedName, '候选区域应标明默认映射结果')
      assert.equal(data.confirmedFoods[0].canonicalNameZh, data.foods[0].mappedName, '默认映射名称应与已确认食材一致')
      assert.equal(data.scrollIntoView, 'confirm-section', '自动映射后应定位到份量确认区')
      assert.deepEqual(data.confirmedFoods.map((item) => item.ratioPercent), [100], '自动映射单一食材时应固定占比100%')
      assert.equal(data.confirmedFoods[0].consumedAmount, '200', '自动映射单一食材应换算为全部摄入量')
      assert.equal(data.weightHint, '约1个橙子', '200克应有橙子参照')
      assert.equal(data.weightBubbleVisible, false, '未拖动时不应预先显示重量参照')
      assert.equal(await result.$('.meal-weight-bubble'), null, '默认状态不应占用悬浮参照空间')
      assert.equal(await result.$('.meal-weight-examples'), null, '页面下方不应再展示全部重量图例')
      const defaultWeightTarget = screenshotPath('result-weight-200')
      await miniProgram.screenshot({ path: defaultWeightTarget })
      await result.callMethod('onMealWeightChanging', { detail: { value: 47 } })
      data = await result.data()
      assert.equal(data.mealTotalAmount, '50', '滑块接近50克刻度时应吸附')
      assert.equal(data.sliderAmount, 47, '拖动期间原生滑块应保持手指位置，避免吸附回写导致抖动')
      assert.equal(data.bubblePercent, 50 / 3, '同一示例区间的悬浮图应固定在参考刻度')
      assert.equal(data.weightBubbleVisible, true, '拖动期间应允许显示对应重量参照')
      assert.ok(await result.$('.weight-reference-item'), '拖动到参照重量时应显示独立且完整的食物小图')
      await result.callMethod('onMealWeightChanging', { detail: { value: 53 } })
      data = await result.data()
      assert.equal(data.sliderAmount, 53, '拖动跨过50克后仍应跟随手指')
      assert.equal(data.mealTotalAmount, '50', '参考克数附近保持吸附后的摄入值')
      assert.equal(data.bubblePercent, 50 / 3, '拖动穿过50克时参照图不应左右抖动')
      await result.callMethod('onMealWeightChange', { detail: { value: 43 } })
      data = await result.data()
      assert.equal(data.mealTotalAmount, '43', '离刻度较远时应保留原重量')
      assert.equal(data.weightHint, '约1个蛋', '43克处于50克示例的±10克范围')
      assert.equal(data.weightBubbleVisible, false, '滑块松手后应立即隐藏参照')
      await result.callMethod('onMealWeightChanging', { detail: { value: 69 } })
      data = await result.data()
      assert.equal(data.weightHint, '', '69克未进入香蕉的70～90克示例范围')
      await result.callMethod('onMealWeightChanging', { detail: { value: 70 } })
      data = await result.data()
      assert.equal(data.weightHint, '约1根香蕉', '70克应进入香蕉示例范围')
      const bananaWeightTarget = screenshotPath('result-weight-banana')
      await result.callMethod('onMealWeightChanging', { detail: { value: 80 } })
      data = await result.data()
      assert.equal(data.weightIcon, '/assets/weight-example-80-v1.png', '香蕉参照应显示用户提供的独立图片')
      await miniProgram.screenshot({ path: bananaWeightTarget })
      await result.callMethod('onMealWeightChanging', { detail: { value: 90 } })
      data = await result.data()
      assert.equal(data.weightHint, '约1根香蕉', '90克交界点应优先展示香蕉示例')
      await result.callMethod('onMealWeightChanging', { detail: { value: 91 } })
      data = await result.data()
      assert.equal(data.weightHint, '约2个蛋', '离开香蕉区间后应选择距离最近的两蛋示例')
      await result.callMethod('onMealWeightChanging', { detail: { value: 300 } })
      data = await result.data()
      assert.equal(data.weightIcon, '/assets/weight-example-300-v1.png', '300克参照应显示完整的苹果、香蕉和鸡蛋图片')
      const combinedWeightTarget = screenshotPath('result-weight-combined')
      await miniProgram.screenshot({ path: combinedWeightTarget })
      await result.callMethod('onMealWeightChange', { detail: { value: 300 } })
      await result.callMethod('onMealTotalInput', { detail: { value: '170' } })
      data = await result.data()
      assert.equal(data.weightHint, '约1个苹果', '170克应有苹果参照')
      assert.equal(data.weightBubbleVisible, false, '手动输入不应常驻显示参照')
      assert.equal(data.confirmedFoods[0].consumedAmount, '170', '总量改变后食材摄入量应联动')
      const weightTarget = screenshotPath('result-weight-picker')
      await miniProgram.screenshot({ path: weightTarget })
      await result.callMethod('onMealWeightChanging', { detail: { value: 170 } })
      assert.ok(await result.$('.meal-weight-bubble'), '拖动到170克时应显示苹果参照')
      const draggingWeightTarget = screenshotPath('result-weight-dragging')
      await miniProgram.screenshot({ path: draggingWeightTarget })
      await result.callMethod('onMealWeightChange', { detail: { value: 170 } })
      assert.equal(await result.$('.meal-weight-bubble'), null, '松手后苹果参照应消失')
      await result.callMethod('onMealTotalInput', { detail: { value: '650' } })
      data = await result.data()
      assert.equal(data.mealTotalAmount, '650', '手动输入应支持超过300克')
      assert.equal(data.sliderAmount, 300, '超过滑块范围时滑块停在300克')
      assert.ok(data.weightWarning.includes('核对'), '超过300克应提示用户核对')
      assert.equal(data.confirmedFoods[0].consumedAmount, '650', '手动输入仍应联动食材重量')
      const highWeightTarget = screenshotPath('result-weight-over-300')
      await miniProgram.screenshot({ path: highWeightTarget })
      await result.callMethod('onMealTotalInput', { detail: { value: '1001' } })
      data = await result.data()
      assert.ok(data.weightWarning.includes('1000'), '超过1000克应提示上限')
      await result.callMethod('onMealWeightChange', { detail: { value: 200 } })
      data = await result.data()
      assert.equal(data.mealTotalAmount, '200', '滑回200克后应恢复总重量')
      assert.equal(data.weightBubbleVisible, false, '滑回200克松手后也不应常驻显示橙子参照')
      await miniProgram.mockWxMethod('showActionSheet', { tapIndex: 0 })
      const row = await result.$('.food-row')
      assert.ok(row, '候选食物应可点击')
      await row.tap()
      await delay(1200)
      for (let attempt = 0; attempt < 12; attempt += 1) {
        data = await result.data()
        if (!data.busy && data.pendingCandidateIndex === -1 && data.confirmedFoods.length) break
        await delay(500)
      }
      data = await result.data()
      assert.equal(data.confirmedFoods.length, 1, '点击已映射候选应替换选择而不是重复新增')
      assert.equal(data.confirmedFoods[0].candidateIndex, 0, '手动改选后仍应关联原识别候选')
      assert.equal(data.amountModes, undefined, '页面不应再保留手动填写或克数滑条模式')
      assert.equal(data.mealTotalAmount, '200', '唯一的总量占比模式默认本餐总量应为200克')
      assert.deepEqual(data.confirmedFoods.map((item) => item.ratioPercent), [100], '只有一种食材时应固定占比100%')
      assert.equal(data.confirmedFoods[0].consumedAmount, '200', '单一食材应自动换算为全部摄入量')
      await result.callMethod('selectFood', {
        foodId: 'fixture-tofu', canonicalNameZh: '豆腐', foodForm: null, processingMethod: null,
      })
      data = await result.data()
      assert.deepEqual(data.confirmedFoods.map((item) => item.ratioPercent), [50, 50], '两种食材默认应均分为50%/50%')
      await result.callMethod('onRatioSliderChange', { currentTarget: { dataset: { index: 0 } }, detail: { value: 60 } })
      data = await result.data()
      assert.equal(data.ratioTotal, 100, '总量占比模式的食材占比应可调整到100%')
      assert.deepEqual(data.confirmedFoods.map((item) => item.ratioPercent), [60, 40], '第一种调整为60%时第二种应联动为40%')
      assert.deepEqual(data.confirmedFoods.map((item) => item.consumedAmount), ['120', '80'], '总量200克按60%/40%应换算为120克和80克')
      await result.callMethod('onRatioSliderChange', { currentTarget: { dataset: { index: 1 } }, detail: { value: 80 } })
      data = await result.data()
      assert.deepEqual(data.confirmedFoods.map((item) => item.ratioPercent), [20, 80], '最后一项也应可调整，必要时回退联动已调整食材')
      const fiveFoods = ['米饭', '豆腐', '鸡蛋', '青菜', '胡萝卜'].map((name, index) => ({
        ...data.confirmedFoods[0], localId: `linked-${index}`, canonicalNameZh: name, observedName: name,
        ratioPercent: 20, ratioAdjustedOrder: 0, consumedAmount: '40',
      }))
      await result.setData({ confirmedFoods: fiveFoods, mealTotalAmount: '200', ratioTotal: 100, ratioAdjustmentSequence: 0 })
      await result.callMethod('onRatioSliderChange', { currentTarget: { dataset: { index: 2 } }, detail: { value: 30 } })
      data = await result.data()
      assert.deepEqual(data.confirmedFoods.map((item) => item.ratioPercent), [20, 20, 30, 10, 20], '调整第三项时应优先联动后方未调整食材')
      assert.deepEqual(data.confirmedFoods.map((item) => item.consumedAmount), ['40', '40', '60', '20', '40'], '五种食材克数应随联动占比即时换算')
      await result.callMethod('onRatioSliderChange', { currentTarget: { dataset: { index: 0 } }, detail: { value: 30 } })
      data = await result.data()
      assert.deepEqual(data.confirmedFoods.map((item) => item.ratioPercent), [30, 10, 30, 10, 20], '再调整第一项时应优先改动未调整项，保留第三项的手动结果')
      assert.equal(data.ratioTotal, 100, '多次任意调整后总占比仍应保持100%')
      assert.equal(await result.$('.ratio-total'), null, '页面不应再重复展示食材占比合计模块')
      assert.ok(await result.$('.ratio-slider-thumb'), '占比滑条应展示自定义白色描边滑块')
      const target = screenshotPath('result-ratio-mode')
      await miniProgram.screenshot({ path: target })
      await miniProgram.restoreWxMethod('showActionSheet')
      await miniProgram.reLaunch('/pages/index/index')
      await delay(1500)
      console.log(JSON.stringify({
        confirmedFoodCount: data.confirmedFoods.length,
        scrollIntoView: data.scrollIntoView,
        autoMappingWorks: true,
        manualRemappingWorks: true,
        weightPickerWorks: true,
        defaultWeightScreenshot: defaultWeightTarget,
        weightScreenshot: weightTarget,
        draggingWeightScreenshot: draggingWeightTarget,
        bananaWeightScreenshot: bananaWeightTarget,
        combinedWeightScreenshot: combinedWeightTarget,
        highWeightScreenshot: highWeightTarget,
        ratioOnlyModeWorks: true,
        draftCleaned: !(await miniProgram.callWxMethod('getStorageSync', 'foodmaster.currentMealId')),
        screenshot: target,
      }))
      return
    }

    throw new Error(`未知命令：${command}`)
  } finally {
    miniProgram.disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
