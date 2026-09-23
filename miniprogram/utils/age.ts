export function ageMonths(birthDate: string, today = new Date()): number {
  const birth = new Date(`${birthDate}T00:00:00`)
  let months = (today.getFullYear() - birth.getFullYear()) * 12 + today.getMonth() - birth.getMonth()
  if (today.getDate() < birth.getDate()) months -= 1
  return Math.max(0, months)
}

export function ageDisplayFromMonths(months: number): string {
  const safeMonths = Math.max(0, Math.floor(months))
  if (safeMonths < 12) return `${safeMonths}个月`
  const years = Math.floor(safeMonths / 12)
  const remainingMonths = safeMonths % 12
  const yearText = remainingMonths ? `${years}岁${remainingMonths}个月` : `${years}岁`
  return `${safeMonths}个月（${yearText}）`
}

export function ageDisplay(birthDate: string, today = new Date()): string {
  return ageDisplayFromMonths(ageMonths(birthDate, today))
}
