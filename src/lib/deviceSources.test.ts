import test from 'node:test'
import assert from 'node:assert/strict'

import { isCameraDevice, isCaptureDevice, mergeCaptureSources, shouldUseDisplayCapture } from './deviceSources.ts'

test('mergeCaptureSources keeps Elgato and screen sources together', () => {
  const result = mergeCaptureSources(
    ['Laptop Screen', 'Color LCD'],
    ['Elgato 4K S', 'FaceTime HD Camera', 'Owl Lite Webcam'],
  )

  assert.ok(result.includes('Laptop Screen'))
  assert.ok(result.includes('Elgato 4K S'))
  assert.ok(!result.includes('FaceTime HD Camera'))
  assert.ok(!result.includes('Owl Lite Webcam'))
  assert.equal(new Set(result).size, result.length)
})

test('isCameraDevice distinguishes webcam-like devices from capture devices', () => {
  assert.equal(isCameraDevice('FaceTime HD Camera'), true)
  assert.equal(isCameraDevice('Owl Lite Webcam'), true)
  assert.equal(isCameraDevice('Elgato 4K S'), false)
  assert.equal(isCaptureDevice('Elgato 4K S'), true)
  assert.equal(isCaptureDevice('Laptop Screen'), true)
})

test('shouldUseDisplayCapture treats Elgato as a video source, not a display', () => {
  assert.equal(shouldUseDisplayCapture('Elgato 4K S'), false)
  assert.equal(shouldUseDisplayCapture('Laptop Screen'), true)
})
