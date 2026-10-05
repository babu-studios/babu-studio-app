export const normalizeAudioDeviceName = (deviceName: string) => deviceName.toLowerCase().replace(/\s+/g, ' ').trim()

export const shouldKeepAudioDevice = (deviceName: string) => {
  const normalized = normalizeAudioDeviceName(deviceName)

  if (!normalized) {
    return false
  }

  if (
    normalized.includes('microsoft teams')
    || normalized.includes('microsoft teams audio')
    || normalized.includes('elgato 4k s')
    || normalized.includes('default elgato')
    || normalized.includes('owl lite audio')
  ) {
    return false
  }

  if (normalized === 'macbook air speakers') {
    return false
  }

  if (normalized.startsWith('macbook air speakers') && !normalized.includes('built-in')) {
    return false
  }

  return true
}

export const buildOutputDeviceIdMap = (
  outputEntries: Array<{ label: string; deviceId: string }> = [],
) => {
  const deviceMap: Record<string, string> = {}

  for (const output of outputEntries) {
    const label = output.label?.trim()

    if (!label || deviceMap[label]) {
      continue
    }

    deviceMap[label] = output.deviceId
  }

  return deviceMap
}

export const createOutputAudioElement = (
  stream: MediaStream | null,
  outputDeviceId?: string,
  volumePercent = 100,
) => {
  if (!stream) {
    return null
  }

  const volume = Math.min(1, Math.max(0, volumePercent / 100))

  const audioElement = new Audio()
  audioElement.srcObject = stream
  audioElement.volume = volume
  audioElement.muted = false

  if (outputDeviceId && 'setSinkId' in audioElement && typeof audioElement.setSinkId === 'function') {
    audioElement.setSinkId(outputDeviceId).catch(() => undefined)
  }

  audioElement.play().catch(() => undefined)

  return audioElement
}
