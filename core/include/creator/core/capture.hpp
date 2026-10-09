#pragma once

#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace creator::core {

struct VideoModeInfo {
  int width = 0;
  int height = 0;
  double max_fps = 0;
};

struct DeviceInfo {
  std::string id;
  std::string name;
  std::string kind;  // "video" or "audio"
  bool is_default = false;
  bool has_audio = false;
  std::vector<VideoModeInfo> modes;
};

enum class MediaKind { Video, Audio };

// Result of checking (not requesting) camera / microphone permission.
// Electron asks for access; the media core only verifies it.
bool has_media_access(MediaKind kind, std::string& error);

std::vector<DeviceInfo> list_capture_devices();
std::string devices_to_json(const std::vector<DeviceInfo>& devices);

struct VideoSourceConfig {
  std::string device_name;  // matched against the device's localized name
  int width = 1920;
  int height = 1080;
  int fps = 60;
  bool exact_size = true;  // false lets the source fall back to the closest supported size
};

struct VideoSourceInfo {
  std::string device_name;
  int width = 0;
  int height = 0;
  double fps = 0;
};

// pixel_buffer is a borrowed CVPixelBufferRef valid only during the callback;
// retain it (CVPixelBufferRetain) to keep it longer. host_time_us is the
// CoreMedia host-clock presentation time of the frame.
using VideoFrameCallback = std::function<void(void* pixel_buffer, std::int64_t host_time_us)>;

class NativeVideoSource {
 public:
  virtual ~NativeVideoSource() = default;
  virtual bool open(const VideoSourceConfig& config, VideoSourceInfo& info, std::string& error) = 0;
  virtual bool start(VideoFrameCallback callback, std::string& error) = 0;
  virtual void stop() = 0;
  // Set when the device is unplugged or the session fails while running.
  virtual bool failed(std::string& error) const = 0;
};

struct AudioSourceConfig {
  std::string device_name;  // empty selects the system default input
  bool require_name = false;
};

// Interleaved float32 PCM, always stereo at 48 kHz (macOS converts for us).
using AudioChunkCallback = std::function<void(const float* interleaved, int frames, std::int64_t host_time_us)>;

class NativeAudioSource {
 public:
  virtual ~NativeAudioSource() = default;
  virtual bool open(const AudioSourceConfig& config, std::string& device_name, std::string& error) = 0;
  virtual bool start(AudioChunkCallback callback, std::string& error) = 0;
  virtual void stop() = 0;
  virtual bool failed(std::string& error) const = 0;
};

std::unique_ptr<NativeVideoSource> create_native_video_source();
std::unique_ptr<NativeAudioSource> create_native_audio_source();

// Pixel buffer helpers so the portable recorder never touches CoreVideo directly.
void* retain_pixel_buffer(void* pixel_buffer);
void release_pixel_buffer(void* pixel_buffer);
// Copies a bi-planar NV12 buffer into caller planes. Returns false for other formats.
bool copy_pixel_buffer_nv12(void* pixel_buffer, std::uint8_t* y, int y_stride, std::uint8_t* uv, int uv_stride,
                            int width, int height);

// CoreMedia host clock in microseconds; the same timebase capture timestamps use.
std::int64_t host_time_now_us();

}  // namespace creator::core
