#pragma once

#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "creator/core/capture.hpp"

struct AVFormatContext;

namespace creator::core {

enum class RecordingMode { Horizontal, Vertical };
enum class RecordingState { Idle, Starting, Recording, Stopping, Completed, Error };

struct RecordingConfig {
  RecordingMode mode = RecordingMode::Horizontal;
  int canvas_width = 1920;
  int canvas_height = 1080;
  int fps = 60;
  int capture_width = 1920;
  int capture_height = 1080;
  bool capture_exact_size = true;  // false lets non-capture-card sources use the closest supported size
  int webcam_width = 1280;
  int webcam_height = 720;
  int webcam_fps = 30;
  double game_volume = 1.0;
  double microphone_volume = 1.0;
  // Device names as shown in the UI. An empty name means that source is not recorded,
  // except the microphone, which uses the system default input when enabled.
  std::string capture_card_device;
  std::string camera_device;
  std::string game_audio_device;
  std::string microphone_device;
  bool microphone_enabled = true;
  bool synthetic = false;  // generated test sources instead of hardware
  std::string output_directory;
  std::string master_file_name = "master.mkv";
};

struct TrackStat {
  std::string name;
  std::string kind;
  std::string device;
  std::string codec;
  std::int64_t frames = 0;  // video frames written, or audio samples per channel
  std::int64_t start_offset_ms = 0;
  int width = 0;
  int height = 0;
  int sample_rate = 0;
  int channels = 0;
  double actual_fps = 0;
};

struct RecordingInfo {
  RecordingState state = RecordingState::Idle;
  std::string file_path;
  std::string error;
  std::int64_t duration_ms = 0;
  std::int64_t file_size_bytes = 0;
  std::int64_t dropped_video_frames = 0;
  std::int64_t dropped_audio_frames = 0;
  std::vector<std::string> video_tracks;
  std::vector<std::string> audio_tracks;
  std::vector<TrackStat> track_stats;
  double write_mb_per_second = 0;
  RecordingMode mode = RecordingMode::Horizontal;
};

// Single monotonic clock (CoreMedia host clock) every track is timestamped against.
class MasterClock {
 public:
  void start() { origin_us_ = host_time_now_us(); }
  [[nodiscard]] std::int64_t origin_us() const { return origin_us_; }
  [[nodiscard]] std::int64_t now_us() const { return host_time_now_us() - origin_us_; }

 private:
  std::int64_t origin_us_ = 0;
};

const char* to_string(RecordingState state);
const char* to_string(RecordingMode mode);

// Writes ONE master.mkv holding gameplay video, webcam video, game audio and
// microphone audio as separate, never-mixed tracks on a shared clock.
class MasterRecorder {
 public:
  MasterRecorder();
  ~MasterRecorder();
  MasterRecorder(const MasterRecorder&) = delete;
  MasterRecorder& operator=(const MasterRecorder&) = delete;

  [[nodiscard]] bool start(const RecordingConfig& config, std::string& error);
  [[nodiscard]] RecordingInfo stop();
  [[nodiscard]] RecordingInfo info() const;

 private:
  struct Track;
  bool open_encoder(Track& track, std::string& error);
  void push_video(Track& track, void* pixel_buffer, std::int64_t host_time_us);
  void push_audio(Track& track, const float* interleaved, int frames, std::int64_t host_time_us);
  void drain_audio(Track& track, bool flush);
  void run_synthetic_video(Track& track);
  void run_synthetic_audio(Track& track);
  void watch_sources();
  bool encode(Track& track, bool flush);
  void fail(const std::string& message);
  void cleanup();
  RecordingInfo snapshot_locked() const;

  RecordingConfig config_;
  MasterClock clock_;
  mutable std::mutex mutex_;
  std::mutex mux_mutex_;
  AVFormatContext* format_ = nullptr;
  std::vector<std::unique_ptr<Track>> tracks_;
  std::vector<std::thread> threads_;
  std::atomic<bool> running_{false};
  bool active_ = false;
  std::atomic<std::int64_t> dropped_video_{0};
  std::atomic<std::int64_t> dropped_audio_{0};
  RecordingState state_ = RecordingState::Idle;
  std::string file_path_;
  std::string error_;
  RecordingInfo last_result_;
};

}  // namespace creator::core
