import { describe, expect, it, vi } from 'vitest'
import { buildOutputDeviceIdMap, createOutputAudioElement, shouldKeepAudioDevice } from './audioRouting'

describe('shouldKeepAudioDevice', () => {
  it('keeps built-in MacBook speaker variants but drops the generic plain label', () => {
    expect(shouldKeepAudioDevice('MacBook Air Speakers')).toBe(false)
    expect(shouldKeepAudioDevice('MacBook Air Speakers (Built-in)')).toBe(true)
    expect(shouldKeepAudioDevice('Default - External Headphones (Built-in)')).toBe(true)
    expect(shouldKeepAudioDevice('External Headphones (Built-in)')).toBe(true)
  })
})

describe('buildOutputDeviceIdMap', () => {
  it('keeps the first matching output device id for a label when duplicates appear', () => {
    const map = buildOutputDeviceIdMap([
      { label: 'MacBook Air Speakers', deviceId: 'built-in-speaker' },
      { label: 'MacBook Air Speakers', deviceId: 'headphone-output' },
    ])

    expect(map['MacBook Air Speakers']).toBe('built-in-speaker')
  })
})

describe('createOutputAudioElement', () => {
  it('keeps the stream playing even when no sink device id is available', () => {
    const stream = { id: 'capture-audio' } as MediaStream
    const play = vi.fn().mockResolvedValue(undefined)
    const audioElement = {
      srcObject: null,
      volume: 1,
      muted: false,
      play,
    }

    const AudioMock = vi.fn(function (this: typeof audioElement) {
      Object.assign(this, audioElement)
    })

    // @ts-expect-error minimal browser mock for the routing helper
    globalThis.Audio = AudioMock

    const created = createOutputAudioElement(stream)

    expect(created).not.toBeNull()
    expect(created?.srcObject).toBe(stream)
    expect(created?.muted).toBe(false)
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('applies the selected output gain percentage to the routed audio element', () => {
    const stream = { id: 'capture-audio' } as MediaStream
    const play = vi.fn().mockResolvedValue(undefined)
    const audioElement = {
      srcObject: null,
      volume: 1,
      muted: false,
      play,
    }

    const AudioMock = vi.fn(function (this: typeof audioElement) {
      Object.assign(this, audioElement)
    })

    // @ts-expect-error minimal browser mock for the routing helper
    globalThis.Audio = AudioMock

    const created = createOutputAudioElement(stream, undefined, 35)

    expect(created).not.toBeNull()
    expect(created?.volume).toBe(0.35)
  })
})
