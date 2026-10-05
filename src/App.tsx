import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { buildOutputDeviceIdMap, createOutputAudioElement, shouldKeepAudioDevice } from './lib/audioRouting'
import {
  isCameraDevice,
  isCaptureDevice,
  mergeCaptureSources,
  resolveCaptureMediaConstraints,
  shouldUseDisplayCapture,
} from './lib/deviceSources'
import './App.css'

const sceneOptions = ['Landscape', 'Vertical']

type AudioDeviceList = {
  inputDevices: string[]
  outputDevices: string[]
}

function App() {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    layers: true,
    scenes: true,
    mixer: true,
    soundOutput: true,
  })

  const [isLandscapeActive, setIsLandscapeActive] = useState(true)
  const [isVerticalActive, setIsVerticalActive] = useState(true)
  const [micMuted, setMicMuted] = useState(false)
  const [outputMuted, setOutputMuted] = useState(false)
  const [micLevel, setMicLevel] = useState(60)
  const [liveMicLevel, setLiveMicLevel] = useState(0)
  const [outputLevel, setOutputLevel] = useState(60)
  const [activeCameraDevices, setActiveCameraDevices] = useState<string[]>(['FaceTime HD Camera'])
  const [selectedCamera, setSelectedCamera] = useState('')
  const [activeCaptureSources, setActiveCaptureSources] = useState<string[]>([])
  const [selectedGameCapture, setSelectedGameCapture] = useState('')
  const [audioInputDevices, setAudioInputDevices] = useState<string[]>(['Built-in Microphone'])
  const [audioOutputDevices, setAudioOutputDevices] = useState<string[]>(['MacBook Air Speakers'])
  const [selectedMicInput, setSelectedMicInput] = useState('')
  const [selectedAudioOutput, setSelectedAudioOutput] = useState('')
  const [cameraError, setCameraError] = useState('')
  const [displayError, setDisplayError] = useState('')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isAudioRefreshing, setIsAudioRefreshing] = useState(false)
  const [refreshPulse, setRefreshPulse] = useState(false)
  const previewRefs = useRef<Array<HTMLVideoElement | null>>([])
  const displayPreviewRefs = useRef<Array<HTMLVideoElement | null>>([])
  const outputAudioElementRef = useRef<HTMLAudioElement | null>(null)
  const captureAudioStreamRef = useRef<MediaStream | null>(null)
  const outputDeviceIdsRef = useRef<Record<string, string>>({})
  const micMonitorRef = useRef<{ stream: MediaStream | null; analyser: AnalyserNode | null; rafId: number | null }>({
    stream: null,
    analyser: null,
    rafId: null,
  })
  const outputMonitorRef = useRef<{
    stream: MediaStream | null
    analyser: AnalyserNode | null
    rafId: number | null
    source: MediaStreamAudioSourceNode | null
    context: AudioContext | null
  }>({
    stream: null,
    analyser: null,
    rafId: null,
    source: null,
    context: null,
  })

  const stopOutputMonitoring = () => {
    if (outputMonitorRef.current.rafId) {
      window.cancelAnimationFrame(outputMonitorRef.current.rafId)
      outputMonitorRef.current.rafId = null
    }

    if (outputMonitorRef.current.source) {
      outputMonitorRef.current.source.disconnect()
      outputMonitorRef.current.source = null
    }

    if (outputMonitorRef.current.analyser) {
      outputMonitorRef.current.analyser.disconnect()
      outputMonitorRef.current.analyser = null
    }

    if (outputMonitorRef.current.context) {
      void outputMonitorRef.current.context.close()
      outputMonitorRef.current.context = null
    }

    outputMonitorRef.current.stream = null
  }

  const refreshCameraDevices = async () => {
    setIsRefreshing(true)
    setRefreshPulse(false)

    try {
      const rustDevices = await invoke<string[]>('list_active_cameras').catch(() => [])
      const browserDevices = navigator.mediaDevices
        ? await navigator.mediaDevices.enumerateDevices().then((devices) =>
            devices
              .filter((device) => device.kind === 'videoinput')
              .map((device) => device.label)
              .filter((label) => isCameraDevice(label)),
          )
        : []

      const filteredRustDevices = rustDevices.filter((device) => isCameraDevice(device))
      const uniqueDevices = [...new Set([...filteredRustDevices, ...browserDevices].filter(Boolean))]

      if (uniqueDevices.length > 0) {
        setActiveCameraDevices(uniqueDevices)
        setSelectedCamera((current) => {
          if (current && uniqueDevices.includes(current)) {
            return current
          }

          return ''
        })
      } else {
        setActiveCameraDevices([])
        setSelectedCamera('')
      }

      setRefreshPulse(true)
      window.setTimeout(() => setRefreshPulse(false), 1200)
    } catch (error) {
      console.error('Failed to load camera devices:', error)
    } finally {
      setIsRefreshing(false)
    }
  }

  const refreshCaptureSources = async () => {
    try {
      const sources = await invoke<string[]>('list_active_capture_sources').catch(() => [])
      const browserVideoInputs = navigator.mediaDevices
        ? await navigator.mediaDevices.enumerateDevices().then((devices) =>
            devices
              .filter((device) => device.kind === 'videoinput')
              .map((device) => device.label)
              .filter((label) => isCaptureDevice(label)),
          )
        : []

      const mergedSources = mergeCaptureSources(sources, browserVideoInputs)

      if (mergedSources.length > 0) {
        setActiveCaptureSources(mergedSources)
        setSelectedGameCapture((current) => {
          if (current && mergedSources.includes(current)) {
            return current
          }

          return current || ''
        })
      }
    } catch (error) {
      console.error('Failed to load capture sources:', error)
    }
  }

  const stopOutputAudioRouting = () => {
    if (outputAudioElementRef.current) {
      outputAudioElementRef.current.pause()
      outputAudioElementRef.current.srcObject = null
      outputAudioElementRef.current.muted = true
      outputAudioElementRef.current = null
    }
    captureAudioStreamRef.current = null
    stopOutputMonitoring()
  }

  const routeCaptureAudioToOutput = (stream: MediaStream | null, outputSelection = selectedAudioOutput) => {
    if (!stream || !outputSelection) {
      stopOutputAudioRouting()
      return
    }

    const outputDeviceId = outputDeviceIdsRef.current[outputSelection]

    if (outputAudioElementRef.current) {
      outputAudioElementRef.current.pause()
      outputAudioElementRef.current.srcObject = null
    }

    stopOutputMonitoring()

    const audioElement = createOutputAudioElement(stream, outputDeviceId, outputLevel)
    if (!audioElement) {
      stopOutputAudioRouting()
      return
    }

    audioElement.muted = outputMuted
    outputAudioElementRef.current = audioElement
    captureAudioStreamRef.current = stream
  }

  useEffect(() => {
    if (outputAudioElementRef.current) {
      outputAudioElementRef.current.volume = Math.min(1, Math.max(0, outputLevel / 100))
      outputAudioElementRef.current.muted = outputMuted
    }
  }, [outputLevel, outputMuted])

  const handleAudioOutputSelection = (nextOutput: string) => {
    setSelectedAudioOutput(nextOutput)

    if (captureAudioStreamRef.current) {
      routeCaptureAudioToOutput(captureAudioStreamRef.current, nextOutput)
    }
  }

  const refreshAudioDevices = async () => {
    setIsAudioRefreshing(true)

    try {
      const rustDevices = await invoke<AudioDeviceList>('list_active_audio_devices').catch(() => ({
        inputDevices: ['Built-in Microphone'],
        outputDevices: ['MacBook Air Speakers'],
      }))

      let browserAudioInputs: string[] = []
      let browserAudioOutputEntries: Array<{ label: string; deviceId: string }> = []

      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null)
        if (permissionStream) {
          const devices = await navigator.mediaDevices.enumerateDevices()
          browserAudioInputs = devices
            .filter((device) => device.kind === 'audioinput')
            .map((device) => device.label)
            .filter(Boolean)
          browserAudioOutputEntries = devices
            .filter((device) => device.kind === 'audiooutput')
            .map((device) => ({
              label: device.label,
              deviceId: device.deviceId,
            }))
            .filter((device) => Boolean(device.label) && Boolean(device.deviceId))

          permissionStream.getTracks().forEach((track) => track.stop())
        }
      }

      if (browserAudioInputs.length === 0 && navigator.mediaDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices()
        browserAudioInputs = devices
          .filter((device) => device.kind === 'audioinput')
          .map((device) => device.label)
          .filter(Boolean)
        browserAudioOutputEntries = devices
          .filter((device) => device.kind === 'audiooutput')
          .map((device) => ({
            label: device.label,
            deviceId: device.deviceId,
          }))
          .filter((device) => Boolean(device.label) && Boolean(device.deviceId))
      }

      const mergedInputs = [...new Set(
        [...rustDevices.inputDevices, ...browserAudioInputs]
          .filter(Boolean)
          .filter((device) => shouldKeepAudioDevice(device)),
      )]
      const mergedOutputs = [...new Set(
        [...rustDevices.outputDevices, ...browserAudioOutputEntries.map((device) => device.label)]
          .filter(Boolean)
          .filter((device) => shouldKeepAudioDevice(device)),
      )]

      outputDeviceIdsRef.current = buildOutputDeviceIdMap(
        browserAudioOutputEntries.filter((device) => shouldKeepAudioDevice(device.label)),
      )

      setAudioInputDevices(mergedInputs.length > 0 ? mergedInputs : ['Built-in Microphone'])
      setAudioOutputDevices(mergedOutputs.length > 0 ? mergedOutputs : ['MacBook Air Speakers'])

      setSelectedMicInput((current) => {
        if (current && mergedInputs.includes(current)) {
          return current
        }

        return mergedInputs[0] ?? 'Built-in Microphone'
      })

      setSelectedAudioOutput((current) => {
        if (current && mergedOutputs.includes(current)) {
          return current
        }

        return mergedOutputs[0] ?? ''
      })
    } catch (error) {
      console.error('Failed to load audio devices:', error)
    } finally {
      setIsAudioRefreshing(false)
    }
  }

  useEffect(() => {
    void refreshCameraDevices()
    void refreshCaptureSources()
    void refreshAudioDevices()

    const audioRefreshTimer = window.setInterval(() => {
      void refreshAudioDevices()
    }, 8000)

    return () => {
      window.clearInterval(audioRefreshTimer)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const stopMonitoring = () => {
      if (micMonitorRef.current.rafId) {
        window.cancelAnimationFrame(micMonitorRef.current.rafId)
        micMonitorRef.current.rafId = null
      }

      if (micMonitorRef.current.stream) {
        micMonitorRef.current.stream.getTracks().forEach((track) => track.stop())
        micMonitorRef.current.stream = null
      }

      micMonitorRef.current.analyser = null
      setLiveMicLevel(0)
    }

    const startMonitoring = async () => {
      if (micMuted) {
        stopMonitoring()
        return
      }

      if (!selectedMicInput || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        stopMonitoring()
        return
      }

      const inputDeviceList = await navigator.mediaDevices.enumerateDevices().catch(() => [])
      const audioInputs = inputDeviceList.filter((device) => device.kind === 'audioinput')
      const matchedDevice = audioInputs.find((device) => device.label === selectedMicInput) ?? audioInputs[0]

      if (!matchedDevice) {
        stopMonitoring()
        return
      }

      stopMonitoring()

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: matchedDevice.deviceId ? { exact: matchedDevice.deviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })

      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      const audioContext = new AudioContext()
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.8

      const source = audioContext.createMediaStreamSource(stream)
      source.connect(analyser)

      micMonitorRef.current.stream = stream
      micMonitorRef.current.analyser = analyser

      const buffer = new Uint8Array(analyser.fftSize)

      const updateMeter = () => {
        if (!micMonitorRef.current.analyser || cancelled) {
          return
        }

        micMonitorRef.current.analyser.getByteTimeDomainData(buffer)

        let sum = 0
        for (let index = 0; index < buffer.length; index += 1) {
          const sample = (buffer[index] - 128) / 128
          sum += sample * sample
        }

        const rms = Math.sqrt(sum / buffer.length)
        const nextLevel = Math.min(100, Math.max(0, Math.round(rms * 220)))
        setLiveMicLevel(nextLevel)
        micMonitorRef.current.rafId = window.requestAnimationFrame(updateMeter)
      }

      updateMeter()
    }

    void startMonitoring()

    return () => {
      cancelled = true
      stopMonitoring()
    }
  }, [selectedMicInput, micMuted])

  useEffect(() => {
    let stream: MediaStream | null = null
    let isCancelled = false
    const videoElement = previewRefs.current[0]

    if (!selectedCamera || !isVerticalActive) {
      if (videoElement) {
        videoElement.srcObject = null
      }
      return
    }

    const connectCameraStream = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError('Camera access is not available in this app session.')
        return
      }

      try {
        const browserDevices = await navigator.mediaDevices.enumerateDevices()
        const videoInputs = browserDevices.filter((device) => device.kind === 'videoinput')
        const matchedDevice = videoInputs.find((device) => device.label === selectedCamera) ?? videoInputs[0]

        const constraints: MediaTrackConstraints & { deviceId?: { exact: string } } = {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          facingMode: 'user',
        }

        if (matchedDevice?.deviceId) {
          constraints.deviceId = { exact: matchedDevice.deviceId }
        }

        stream = await navigator.mediaDevices.getUserMedia({
          video: matchedDevice?.deviceId ? constraints : true,
          audio: false,
        })

        if (isCancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        if (videoElement) {
          videoElement.srcObject = stream
          videoElement.play().catch(() => undefined)
        }

        setCameraError('')
      } catch (error) {
        console.error('Failed to access selected camera:', error)
        setCameraError('Unable to access the selected camera. Check permissions.')
      }
    }

    void connectCameraStream()

    return () => {
      isCancelled = true
      if (stream) {
        stream.getTracks().forEach((track) => track.stop())
      }
      if (videoElement) {
        videoElement.srcObject = null
      }
    }
  }, [selectedCamera, isVerticalActive])

  useEffect(() => {
    let stream: MediaStream | null = null
    let isCancelled = false
    const videoElement = previewRefs.current[1]

    if (!selectedCamera || !isLandscapeActive) {
      if (videoElement) {
        videoElement.srcObject = null
      }
      return
    }

    const connectCameraStream = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError('Camera access is not available in this app session.')
        return
      }

      try {
        const browserDevices = await navigator.mediaDevices.enumerateDevices()
        const videoInputs = browserDevices.filter((device) => device.kind === 'videoinput')
        const matchedDevice = videoInputs.find((device) => device.label === selectedCamera) ?? videoInputs[0]

        const constraints: MediaTrackConstraints & { deviceId?: { exact: string } } = {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          facingMode: 'user',
        }

        if (matchedDevice?.deviceId) {
          constraints.deviceId = { exact: matchedDevice.deviceId }
        }

        stream = await navigator.mediaDevices.getUserMedia({
          video: matchedDevice?.deviceId ? constraints : true,
          audio: false,
        })

        if (isCancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        if (videoElement) {
          videoElement.srcObject = stream
          videoElement.play().catch(() => undefined)
        }

        setCameraError('')
      } catch (error) {
        console.error('Failed to access selected camera:', error)
        setCameraError('Unable to access the selected camera. Check permissions.')
      }
    }

    void connectCameraStream()

    return () => {
      isCancelled = true
      if (stream) {
        stream.getTracks().forEach((track) => track.stop())
      }
      if (videoElement) {
        videoElement.srcObject = null
      }
    }
  }, [selectedCamera, isLandscapeActive])

  useEffect(() => {
    let stream: MediaStream | null = null
    let isCancelled = false
    const videoElement = displayPreviewRefs.current[0]

    if (!selectedGameCapture || !isVerticalActive) {
      if (videoElement) {
        videoElement.srcObject = null
      }
      stopOutputAudioRouting()
      return
    }

    const connectDisplayStream = async () => {
      if (!navigator.mediaDevices) {
        setDisplayError('Display capture is not available in this app session.')
        return
      }

      try {
        if (shouldUseDisplayCapture(selectedGameCapture)) {
          if (!navigator.mediaDevices.getDisplayMedia) {
            setDisplayError('Display capture is not available in this app session.')
            return
          }

          stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              frameRate: 30,
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
            audio: true,
          })
        } else {
          const browserDevices = await navigator.mediaDevices.enumerateDevices()
          const mediaConstraints = resolveCaptureMediaConstraints(selectedGameCapture, browserDevices)

          stream = await navigator.mediaDevices.getUserMedia({
            video: mediaConstraints.video,
            audio: mediaConstraints.audio,
          })
        }

        if (isCancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        if (videoElement) {
          videoElement.srcObject = stream
          videoElement.play().catch(() => undefined)
        }

        captureAudioStreamRef.current = stream
        routeCaptureAudioToOutput(stream)
        setDisplayError('')
      } catch (error) {
        console.error('Failed to access selected capture source:', error)
        setDisplayError('Unable to access the selected source. Choose a valid input or screen.')
      }
    }

    void connectDisplayStream()

    return () => {
      isCancelled = true
      if (stream) {
        stream.getTracks().forEach((track) => track.stop())
      }
      if (videoElement) {
        videoElement.srcObject = null
      }
      if (captureAudioStreamRef.current === stream) {
        stopOutputAudioRouting()
      }
    }
  }, [selectedGameCapture, isVerticalActive])

  useEffect(() => {
    let stream: MediaStream | null = null
    let isCancelled = false
    const videoElement = displayPreviewRefs.current[1]

    if (!selectedGameCapture || !isLandscapeActive) {
      if (videoElement) {
        videoElement.srcObject = null
      }
      stopOutputAudioRouting()
      return
    }

    const connectDisplayStream = async () => {
      if (!navigator.mediaDevices) {
        setDisplayError('Display capture is not available in this app session.')
        return
      }

      try {
        if (shouldUseDisplayCapture(selectedGameCapture)) {
          if (!navigator.mediaDevices.getDisplayMedia) {
            setDisplayError('Display capture is not available in this app session.')
            return
          }

          stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              frameRate: 30,
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
            audio: true,
          })
        } else {
          const browserDevices = await navigator.mediaDevices.enumerateDevices()
          const mediaConstraints = resolveCaptureMediaConstraints(selectedGameCapture, browserDevices)

          stream = await navigator.mediaDevices.getUserMedia({
            video: mediaConstraints.video,
            audio: mediaConstraints.audio,
          })
        }

        if (isCancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        if (videoElement) {
          videoElement.srcObject = stream
          videoElement.play().catch(() => undefined)
        }

        captureAudioStreamRef.current = stream
        routeCaptureAudioToOutput(stream)
        setDisplayError('')
      } catch (error) {
        console.error('Failed to access selected capture source:', error)
        setDisplayError('Unable to access the selected source. Choose a valid input or screen.')
      }
    }

    void connectDisplayStream()

    return () => {
      isCancelled = true
      if (stream) {
        stream.getTracks().forEach((track) => track.stop())
      }
      if (videoElement) {
        videoElement.srcObject = null
      }
      if (captureAudioStreamRef.current === stream) {
        stopOutputAudioRouting()
      }
    }
  }, [selectedGameCapture, isLandscapeActive])

  useEffect(() => {
    if (selectedAudioOutput) {
      routeCaptureAudioToOutput(captureAudioStreamRef.current)
    } else {
      stopOutputAudioRouting()
    }
  }, [selectedAudioOutput])

  useEffect(() => {
    if (outputMuted) {
      stopOutputMonitoring()
      return
    }

    if (captureAudioStreamRef.current && outputAudioElementRef.current) {
      outputAudioElementRef.current.muted = false
    }
  }, [outputMuted, selectedGameCapture, isLandscapeActive, isVerticalActive])

  const toggleSection = (key: string) => {
    setOpenSections((current) => ({
      ...current,
      [key]: !current[key],
    }))
  }

  const toggleScene = (scene: string) => {
    if (scene === 'Landscape') {
      setIsLandscapeActive((current) => !current)
      return
    }

    setIsVerticalActive((current) => !current)
  }

  return (
    <div className="studio-app">
      <header className="topbar">
        <div className="topbar-brand">DUI Studio</div>

        <div className="topbar-actions">
          <button type="button" className="tool-button primary">
            Record
          </button>
          <button type="button" className="tool-button secondary">
            Pause
          </button>
          <button type="button" className="tool-button secondary">
            Resume
          </button>
          <button type="button" className="tool-button secondary">
            Export
          </button>
          <button type="button" className="tool-button danger">
            Stop
          </button>
        </div>
      </header>

      <div className="workspace">
        <main className="main-stage">
          <div className="capture-layout two-panel">
            <div className="capture-panel vertical-panel">
              <div className="panel-blank">
                {!isVerticalActive ? (
                  <div className="scene-inactive-overlay">Vertical inactive</div>
                ) : (
                  <>
                    <div className="display-live-surface">
                      <video
                        ref={(element) => {
                          displayPreviewRefs.current[0] = element
                        }}
                        className="display-video"
                        autoPlay
                        playsInline
                        muted
                      />
                      {!displayError && <div className="display-live-label">{selectedGameCapture}</div>}
                    </div>
                        <div className="camera-overlay-box">
                      <div className="camera-preview">
                        <video
                          ref={(element) => {
                            previewRefs.current[0] = element
                          }}
                          className="camera-video"
                          autoPlay
                          playsInline
                          muted
                        />
                        {cameraError && <div className="camera-status">{cameraError}</div>}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="capture-panel horizontal-panel">
              <div className="panel-blank">
                {!isLandscapeActive ? (
                  <div className="scene-inactive-overlay">Landscape inactive</div>
                ) : (
                  <>
                    <div className="display-live-surface wide">
                  <video
                    ref={(element) => {
                      displayPreviewRefs.current[1] = element
                    }}
                    className="display-video"
                    autoPlay
                    playsInline
                    muted
                  />
                  {!displayError && <div className="display-live-label">{selectedGameCapture}</div>}
                </div>
                    <div className="camera-overlay-box horizontal">
                      <div className="camera-preview">
                        <video
                          ref={(element) => {
                            previewRefs.current[1] = element
                          }}
                          className="camera-video"
                          autoPlay
                          playsInline
                          muted
                        />
                        {cameraError && <div className="camera-status">{cameraError}</div>}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </main>

        <aside className="left-sidebar">
          <div className="accordion-group">
            <div className="accordion-item layers-only">
              <div className="accordion-header">
                <span>Layers</span>
                <button
                  type="button"
                  className={`header-refresh-button ${isRefreshing ? 'spinning' : ''} ${refreshPulse ? 'success' : ''}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    void refreshCameraDevices()
                  }}
                  aria-label="Refresh camera devices"
                  title="Refresh camera devices"
                  disabled={isRefreshing}
                >
                  {refreshPulse ? '✓' : '↻'}
                </button>
              </div>

              <div className="layer-panel">
                <div className="layer-select-stack">
                  <div className="source-box">
                    <span className="source-box-label">Camera</span>
                    <div className="select-with-indicator">
                      <label className="sound-output-select-wrap">
                        <span className="sr-only">Camera</span>
                        <select
                          className="sound-output-select"
                          value={selectedCamera}
                          onChange={(event) => setSelectedCamera(event.target.value)}
                        >
                          <option value="">Select Camera</option>
                          {activeCameraDevices.map((device) => (
                            <option key={device} value={device}>
                              {device}
                            </option>
                          ))}
                        </select>
                      </label>
                      <span className="select-indicator" aria-hidden="true">▾</span>
                    </div>
                  </div>

                  <div className="source-box">
                    <span className="source-box-label">Capture Card</span>
                    <div className="select-with-indicator">
                      <label className="sound-output-select-wrap">
                        <span className="sr-only">Capture Card</span>
                        <select
                          className="sound-output-select"
                          value={selectedGameCapture}
                          onChange={(event) => setSelectedGameCapture(event.target.value)}
                        >
                          <option value="">Select Capture Device</option>
                          {activeCaptureSources.map((source) => (
                            <option key={source} value={source}>
                              {source}
                            </option>
                          ))}
                        </select>
                      </label>
                      <span className="select-indicator" aria-hidden="true">▾</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className={`accordion-item ${openSections.scenes ? 'open' : ''}`}>
              <div className="accordion-header" onClick={() => toggleSection('scenes')}>
                <span>Scenes</span>
                <span className="accordion-chevron">{openSections.scenes ? '▾' : '▸'}</span>
              </div>

              {openSections.scenes && (
                <div className="scene-list">
                  {sceneOptions.map((scene) => {
                    const isActive = scene === 'Landscape' ? isLandscapeActive : isVerticalActive

                    return (
                      <button
                        key={scene}
                        type="button"
                        className={`scene-button ${isActive ? 'active' : ''}`}
                        onClick={() => toggleScene(scene)}
                        aria-pressed={isActive}
                      >
                        <span className="scene-label">{scene}</span>
                        <span className="scene-visibility" aria-hidden="true">
                          {isActive ? '👁' : '◌'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className={`accordion-item ${openSections.mixer ? 'open' : ''}`}>
              <div className="accordion-header" onClick={() => toggleSection('mixer')}>
                <span>Audio Mixer</span>
                <div className="accordion-header-actions">
                  <button
                    type="button"
                    className={`header-refresh-button ${isAudioRefreshing ? 'spinning' : ''}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      void refreshAudioDevices()
                    }}
                    aria-label="Refresh audio devices"
                    title="Refresh audio devices"
                    disabled={isAudioRefreshing}
                  >
                    ↻
                  </button>
                  <span className="accordion-chevron">{openSections.mixer ? '▾' : '▸'}</span>
                </div>
              </div>

              {openSections.mixer && (
                <div className="mixer-panel">
                  <div className="mixer-grid">
                    <div className="source-box audio-box">
                      <div className="audio-box-header">
                        <span className="source-box-label">Mic Input</span>
                      </div>

                      <div className="select-with-indicator">
                        <label className="sound-output-select-wrap">
                          <span className="sr-only">Select MIC Input</span>
                          <select
                            className="sound-output-select"
                            value={selectedMicInput}
                            onChange={(event) => setSelectedMicInput(event.target.value)}
                          >
                            <option value="">Select MIC Input</option>
                            {audioInputDevices.map((device) => (
                              <option key={device} value={device}>
                                {device}
                              </option>
                            ))}
                          </select>
                        </label>
                        <span className="select-indicator" aria-hidden="true">▾</span>
                      </div>

                      <div className="audio-meter" aria-label="Microphone input level">
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((bar) => {
                          const normalizedLevel = Math.min(micLevel, 100)
                          const activeBars = Math.max(
                            0,
                            Math.min(10, Math.round((Math.min(liveMicLevel, normalizedLevel) / 100) * 10)),
                          )
                          const colorClass = bar <= 4
                            ? 'green'
                            : bar <= 7
                              ? 'yellow'
                              : 'red'

                          return (
                            <span
                              key={bar}
                              className={`meter-bar ${bar <= activeBars ? 'active' : ''} ${colorClass}`}
                              style={{
                                height: `${Math.max(12, (bar / 10) * 100)}%`,
                                animationDelay: `${bar * 80}ms`,
                              }}
                            />
                          )
                        })}
                      </div>

                      <div className="volume-controls audio-controls">
                        <button type="button" className="volume-button" onClick={() => setMicLevel((current) => Math.max(0, current - 10))}>
                          -
                        </button>
                        <span className="volume-percent">{micLevel}%</span>
                        <button type="button" className="volume-button" onClick={() => setMicLevel((current) => Math.min(100, current + 10))}>
                          +
                        </button>
                        <button
                          type="button"
                          className={`mute-button small ${micMuted ? 'active' : ''}`}
                          onClick={() => {
                            setMicMuted((current) => !current)
                          }}
                        >
                          {micMuted ? 'Muted' : 'Mute'}
                        </button>
                      </div>
                    </div>

                    <div className="source-box audio-box">
                      <div className="audio-box-header">
                        <span className="source-box-label">Capture Card Sound Output</span>
                      </div>

                      <div className="select-with-indicator">
                        <label className="sound-output-select-wrap">
                          <span className="sr-only">Select Capture Card</span>
                          <select
                            className="sound-output-select"
                            value={selectedAudioOutput}
                            onChange={(event) => handleAudioOutputSelection(event.target.value)}
                          >
                            <option value="">Select Capture Card</option>
                            {audioOutputDevices.map((device) => (
                              <option key={device} value={device}>
                                {device}
                              </option>
                            ))}
                          </select>
                        </label>
                        <span className="select-indicator" aria-hidden="true">▾</span>
                      </div>

                      <div className="volume-controls audio-controls">
                        <button type="button" className="volume-button" onClick={() => setOutputLevel((current) => Math.max(0, current - 10))}>
                          -
                        </button>
                        <span className="volume-percent">{outputLevel}%</span>
                        <button type="button" className="volume-button" onClick={() => setOutputLevel((current) => Math.min(100, current + 10))}>
                          +
                        </button>
                        <button
                          type="button"
                          className={`mute-button small ${outputMuted ? 'active' : ''}`}
                          onClick={() => {
                            setOutputMuted((current) => {
                              const nextValue = !current
                              if (outputAudioElementRef.current) {
                                outputAudioElementRef.current.muted = nextValue
                              }
                              return nextValue
                            })
                          }}
                        >
                          {outputMuted ? 'Muted' : 'Mute'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

          </div>
        </aside>
      </div>

    </div>
  )
}

export default App
