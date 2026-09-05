import { describe, expect, it } from 'vitest'
import { clipboardImageFiles } from './clipboard-images'

function clipboard(items: DataTransferItem[], files: File[] = []): DataTransfer {
  return { items, files } as unknown as DataTransfer
}

describe('clipboardImageFiles', () => {
  it('keeps only image files and leaves text clipboard content alone', () => {
    const image = new File(['image'], 'chart.png', { type: 'image/png' })
    const text = { kind: 'string', type: 'text/plain', getAsFile: () => null } as unknown as DataTransferItem
    const imageItem = { kind: 'file', type: 'image/png', getAsFile: () => image } as unknown as DataTransferItem

    expect(clipboardImageFiles(clipboard([text, imageItem]))).toEqual([image])
    expect(clipboardImageFiles(clipboard([text]))).toEqual([])
  })
})
