import { complianceInfo } from '../../config'

interface PrivacyContractApi {
  openPrivacyContract?: (options: { fail?: () => void }) => void
}

const privacySummary = '食物图片仅用于生成待确认的识别候选。服务端只在请求期间临时接触且不保存原图；原图仅保存在你的本地终端，并按你选择的1个月、半年或1年期限自动删除。不同意不影响手工搜索和基础记录。'

Page({
  data: {
    miniProgramFilingNumber: complianceInfo.miniProgramFilingNumber,
    icpFilingNumber: complianceInfo.icpFilingNumber,
    publicSecurityFilingNumber: complianceInfo.publicSecurityFilingNumber,
  },

  goBack() { wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/profile/profile' }) }) },

  openPrivacyContract() {
    const privacyApi = wx as unknown as PrivacyContractApi
    if (!privacyApi.openPrivacyContract) {
      this.showPrivacySummary()
      return
    }
    privacyApi.openPrivacyContract({ fail: () => this.showPrivacySummary() })
  },

  showPrivacySummary() {
    wx.showModal({ title: '图片与隐私说明', content: privacySummary, showCancel: false, confirmText: '我知道了' })
  },
})
