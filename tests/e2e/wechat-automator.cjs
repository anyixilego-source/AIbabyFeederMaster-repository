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
        errorMessage: '',
      })
      await miniProgram.mockWxMethod('showActionSheet', { tapIndex: 0 })
      const row = await result.$('.food-row')
      assert.ok(row, '候选食物应可点击')
      await row.tap()
      let data
      for (let attempt = 0; attempt < 12; attempt += 1) {
        data = await result.data()
        if (!data.busy && data.confirmedFoods.length) break
        await delay(500)
      }
      data = await result.data()
      assert.equal(data.confirmedFoods.length, 1, '候选应能映射为一个标准食品')
      assert.equal(data.scrollIntoView, 'confirm-section', '映射成功后应定位到份量确认区')
      assert.equal(data.amountMode, 'MANUAL', '份量录入默认应为手动填写')
      await result.callMethod('selectAmountMode', { currentTarget: { dataset: { mode: 'SLIDER' } } })
      await result.callMethod('onConsumedSliderChange', { currentTarget: { dataset: { index: 0 } }, detail: { value: 80 } })
      data = await result.data()
      assert.equal(data.confirmedFoods[0].consumedAmount, '80', '克数滑条应更新实际摄入量')
      await result.setData({
        confirmedFoods: [data.confirmedFoods[0], {
          ...data.confirmedFoods[0], localId: `${data.confirmedFoods[0].localId}-2`, canonicalNameZh: '豆腐',
          observedName: '豆腐', consumedAmount: '', servedAmount: '', ratioPercent: 0, ratioMax: 100, ratioLocked: false,
        }],
      })
      await result.callMethod('selectAmountMode', { currentTarget: { dataset: { mode: 'RATIO' } } })
      data = await result.data()
      assert.equal(data.mealTotalAmount, '200', '总量占比模式默认本餐总量应为200克')
      assert.deepEqual(data.confirmedFoods.map((item) => item.ratioPercent), [50, 50], '两种食材默认应均分为50%/50%')
      await result.callMethod('onRatioSliderChange', { currentTarget: { dataset: { index: 0 } }, detail: { value: 60 } })
      data = await result.data()
      assert.equal(data.ratioTotal, 100, '总量占比模式的食材占比应可调整到100%')
      assert.deepEqual(data.confirmedFoods.map((item) => item.ratioPercent), [60, 40], '第一种调整为60%时第二种应联动为40%')
      assert.deepEqual(data.confirmedFoods.map((item) => item.consumedAmount), ['120', '80'], '总量200克按60%/40%应换算为120克和80克')
      await result.callMethod('onRatioSliderChange', { currentTarget: { dataset: { index: 1 } }, detail: { value: 80 } })
      data = await result.data()
      assert.deepEqual(data.confirmedFoods.map((item) => item.ratioPercent), [60, 40], '最后一项不得单独破坏100%联动关系')
      const fiveFoods = ['米饭', '豆腐', '鸡蛋', '青菜', '胡萝卜'].map((name, index) => ({
        ...data.confirmedFoods[0], localId: `linked-${index}`, canonicalNameZh: name, observedName: name,
        ratioPercent: 20, ratioMax: 40, ratioLocked: index === 4, consumedAmount: '40',
      }))
      await result.setData({ confirmedFoods: fiveFoods, mealTotalAmount: '200', ratioTotal: 100 })
      await result.callMethod('selectAmountMode', { currentTarget: { dataset: { mode: 'RATIO' } } })
      await result.callMethod('onRatioSliderChange', { currentTarget: { dataset: { index: 2 } }, detail: { value: 30 } })
      data = await result.data()
      assert.deepEqual(data.confirmedFoods.map((item) => item.ratioPercent), [20, 20, 30, 10, 20], '调整第三项时应只联动第四项')
      assert.deepEqual(data.confirmedFoods.map((item) => item.consumedAmount), ['40', '40', '60', '20', '40'], '五种食材克数应随联动占比即时换算')
      const target = screenshotPath('result-amount-modes')
      await miniProgram.screenshot({ path: target })
      await miniProgram.restoreWxMethod('showActionSheet')
      await miniProgram.reLaunch('/pages/index/index')
      await delay(1500)
      console.log(JSON.stringify({
        confirmedFoodCount: data.confirmedFoods.length,
        scrollIntoView: data.scrollIntoView,
        amountModesWork: true,
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
