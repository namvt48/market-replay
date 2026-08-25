export function shouldShowCoverageWarning(included: number, excluded: number): boolean {
  const total = included + excluded

  return excluded > 0 && total > 0 && excluded / total >= 0.4
}
