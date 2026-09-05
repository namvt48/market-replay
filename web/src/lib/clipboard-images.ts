/**
 * Extract image files from a browser clipboard without interfering with
 * ordinary text paste. Both the Live journal and Trade Review use this so
 * image paste behaves the same wherever traders write notes.
 */
export function clipboardImageFiles(clipboard: DataTransfer | null): File[] {
  if (!clipboard) return []

  const fromItems = [...clipboard.items]
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)

  if (fromItems.length > 0) return fromItems
  return [...clipboard.files].filter((file) => file.type.startsWith('image/'))
}

export function imageFileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read the pasted image.'))
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Unable to read the pasted image.'))
    }
    reader.readAsDataURL(file)
  })
}
