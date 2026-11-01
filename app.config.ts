export default defineAppConfig({
  ui: {
    colors: {
      primary: 'action',
      secondary: 'neutral',
      neutral: 'neutral',
      success: 'success',
      info: 'info',
      warning: 'warning',
      error: 'danger',
      // Endfield 角色色（已扩展为完整色阶，见 assets/css/endfield/theme.css），
      // 让 @nuxt/ui 组件的 color 属性也能直接用 data/region/gain/notice/special/alert。
      data: 'data',
      region: 'region',
      gain: 'gain',
      notice: 'notice',
      special: 'special',
      alert: 'alert'
    }
  }
})
