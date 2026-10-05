const virtualSourcePattern = /OBS|Meld Studio|Virtual Camera|Epocam|Display Simulator|AirPlay|Fake/i
const screenSourcePattern = /Laptop Screen|Screen|Display|Monitor|Desktop|Color LCD|Built-in.*Display|Built-in.*Retina|Retina|LCD/i
const cameraLikePattern = /FaceTime|Webcam|Camera|Built-in Camera|HD Camera|USB Camera|Owl|iPhone|iSight/i
const captureLikePattern = /Elgato|Capture|CamLink|AVerMedia|DeckLink|Blackmagic|USB Video|Video Capture/i

export function normalizeDeviceLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export function isCameraDevice(value: string): boolean {
  const normalizedName = normalizeDeviceLabel(value)

  if (!normalizedName || virtualSourcePattern.test(normalizedName)) {
    return false
  }

  return cameraLikePattern.test(normalizedName) || /camera/i.test(normalizedName)
}

export function isCaptureDevice(value: string): boolean {
  const normalizedName = normalizeDeviceLabel(value)

  if (!normalizedName || virtualSourcePattern.test(normalizedName)) {
    return false
  }

  return screenSourcePattern.test(normalizedName) || captureLikePattern.test(normalizedName)
}

export function shouldUseDisplayCapture(sourceName: string): boolean {
  const normalizedName = normalizeDeviceLabel(sourceName)

  if (!normalizedName) {
    return false
  }

  return isCaptureDevice(normalizedName) && screenSourcePattern.test(normalizedName) && !captureLikePattern.test(normalizedName)
}

export function mergeCaptureSources(rustSources: string[] = [], browserVideoInputLabels: string[] = []): string[] {
  const combined = [...rustSources, ...browserVideoInputLabels]
    .map((source) => normalizeDeviceLabel(source))
    .filter((source) => source.length > 0)
    .filter((source) => !virtualSourcePattern.test(source))
    .filter((source) => !isCameraDevice(source))

  const screenSources = combined.filter((source) => screenSourcePattern.test(source))
  const captureSources = combined.filter((source) => isCaptureDevice(source))

  return [...new Set([...screenSources, ...captureSources])]
}

export function resolveCaptureMediaConstraints(
  selectedCaptureLabel: string,
  browserDevices: MediaDeviceInfo[] = [],
) {
  const normalizedCapture = normalizeDeviceLabel(selectedCaptureLabel)

  const videoInputs = browserDevices.filter((device) => device.kind === 'videoinput')
  const matchedVideoDevice =
    videoInputs.find((device) => normalizeDeviceLabel(device.label) === normalizedCapture)
      ?? videoInputs.find((device) => normalizeDeviceLabel(device.label).includes(normalizedCapture))
      ?? videoInputs.find((device) => normalizedCapture.includes(normalizeDeviceLabel(device.label)))
      ?? videoInputs[0]
      ?? null

  const audioInputs = browserDevices.filter((device) => device.kind === 'audioinput')
  const matchedAudioDevice =
    audioInputs.find((device) => normalizeDeviceLabel(device.label) === normalizedCapture)
      ?? audioInputs.find((device) => normalizeDeviceLabel(device.label).includes(normalizedCapture))
      ?? audioInputs.find((device) => normalizedCapture.includes(normalizeDeviceLabel(device.label)))
      ?? null

  const videoConstraint = matchedVideoDevice?.deviceId
    ? {
        deviceId: { exact: matchedVideoDevice.deviceId },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      }
    : {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      }

  const audioConstraint = matchedAudioDevice?.deviceId
    ? {
        deviceId: { exact: matchedAudioDevice.deviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      }
    : false

  return {
    video: videoConstraint,
    audio: audioConstraint,
  }
}
