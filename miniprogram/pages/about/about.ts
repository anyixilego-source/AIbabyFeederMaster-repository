import {backPage,openPage} from '../../utils/navigation'
import { complianceInfo } from '../../config'

interface PrivacyContractApi {
  openPrivacyContract?: (options: { fail?: () => void }) => void
}

const privacySummary = '食物图片用于生成待确认的识别候选。拍照记录和图片访问按实际授权及确认页面处理；本地照片按选择的保存期限管理。家庭照片同步需另行同意，新同步照片仅供本宝宝有权照护者查看，云端默认保留30天；到期只删除图片，不删除餐食记录，旧本地图不自动上传。不同意图片授权不影响手工搜索和基础记录。'

Page({
  data: {
    section:'',versionText:'',privacyText:privacySummary,
    miniProgramFilingNumber: complianceInfo.miniProgramFilingNumber,
    icpFilingNumber: complianceInfo.icpFilingNumber,
    publicSecurityFilingNumber: complianceInfo.publicSecurityFilingNumber,
  },

  onLoad(q:Record<string,string>){const section=['privacy','photos','functions','filing'].includes(q.section)?q.section:'';let versionText='体验版 0.1.5';try{const app=wx.getAccountInfoSync().miniProgram,label=app.envVersion==='release'?'正式版':'体验版';versionText=label+' '+(app.version||'0.1.5')}catch{}this.setData({section,versionText})},
  openSection(e:WechatMiniprogram.TouchEvent){const section=String(e.currentTarget.dataset.section||'');if(['privacy','photos','functions','filing'].includes(section))openPage('/pages/about/about?section='+section)},
  openFeedback(){openPage('/pages/feedback/feedback')},
  goBack() { backPage('/pages/profile/profile',this) },

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
