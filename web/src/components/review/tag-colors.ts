import type { ReviewTagColor } from '../../store/review-store'

export const reviewTagColors: Array<{ id: ReviewTagColor; label: string; className: string; badge: string }> = [
  { id: 'green', label: 'Green', className: 'bg-[#36d675]', badge: 'bg-[#123c2a] text-[#74e8a4]' },
  { id: 'blue', label: 'Blue', className: 'bg-[#2962ff]', badge: 'bg-[#162d63] text-[#79a3ff]' },
  { id: 'orange', label: 'Orange', className: 'bg-[#ff8b3d]', badge: 'bg-[#4a2b18] text-[#ffad73]' },
  { id: 'red', label: 'Red', className: 'bg-[#e8756b]', badge: 'bg-[#4a2324] text-[#ff9992]' },
  { id: 'purple', label: 'Purple', className: 'bg-[#bb79e5]', badge: 'bg-[#392449] text-[#d9a3f5]' },
  { id: 'cyan', label: 'Light Blue', className: 'bg-[#18aee5]', badge: 'bg-[#12394a] text-[#69cef2]' },
  { id: 'grey', label: 'Grey', className: 'bg-[#a3a6af]', badge: 'bg-[#30343b] text-[#d0d3d8]' },
]

export function reviewTagBadge(color: ReviewTagColor): string {
  return reviewTagColors.find((item) => item.id === color)?.badge ?? reviewTagColors[6].badge
}
