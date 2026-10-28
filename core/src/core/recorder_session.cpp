#include <algorithm>
#include <chrono>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <mutex>
#include <string>
#include <thread>

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/channel_layout.h>
#include <libavutil/error.h>
#include <libavutil/opt.h>
#include <libswscale/swscale.h>
}

#include "creator/core/recorder_track.hpp"
#include "creator/core/recording.hpp"

namespace creator::core {
namespace {

constexpr int kSampleRate = 48000;

std::string av_message(const int code) {
  char buffer[AV_ERROR_MAX_STRING_SIZE] = {};
  av_strerror(code, buffer, sizeof buffer);
  return buffer;
}

// Video sources record as Matroska, audio sources as M4A.
std::string source_file_name(const std::string& track_name, const bool video) {
  if (track_name == "Gameplay") {
    return "gameplay.mkv";
  }
  if (track_name == "Webcam") {
    return "webcam.mkv";
  }
  if (track_name == "Game Audio") {
    return "game-audio.m4a";
  }
  if (track_name == "Microphone") {
    return "microphone.m4a";
  }
  std::string slug;
  for (const char c : track_name) {
    if (c == ' ' || c == '_') {
      slug += '-';
    } else {
      slug += static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    }
  }
  if (slug.empty()) {
    slug = video ? "video" : "audio";
  }
  return slug + (video ? ".mkv" : ".m4a");
}

}  // namespace

bool MasterRecorder::start(const RecordingConfig& config, std::string& error) {
  {
    std::lock_guard lock(mutex_);
    if (state_ == RecordingState::Starting || state_ == RecordingState::Recording || state_ == RecordingState::Stopping) {
      error = "A recording is already in progress.";
      return false;
    }
    state_ = RecordingState::Starting;
    error_.clear();
    last_result_ = RecordingInfo{};
  }

  config_ = config;
  dropped_video_ = 0;
  dropped_audio_ = 0;

  const auto fail_start = [&](const std::string& message) {
    error = message;
    cleanup();
    std::lock_guard lock(mutex_);
    state_ = RecordingState::Error;
    error_ = message;
    last_result_ = snapshot_locked();
    return false;
  };

  const auto add = [&](Track::Kind kind, std::string name, std::string device) {
    auto track = std::make_unique<Track>();
    track->kind = kind;
    track->synthetic = config.synthetic;
    track->name = std::move(name);
    track->device_name = std::move(device);
    tracks_.push_back(std::move(track));
    return tracks_.back().get();
  };

  if (config.synthetic) {
    Track* game = add(Track::Kind::Video, "Gameplay", "synthetic");
    game->width = 1920;
    game->height = 1080;
    game->fps = config.fps;
    Track* cam = add(Track::Kind::Video, "Webcam", "synthetic");
    cam->width = 1280;
    cam->height = 720;
    cam->fps = config.webcam_fps;
    Track* game_audio = add(Track::Kind::Audio, "Game Audio", "synthetic");
    game_audio->tone_hz = 440.0;
    Track* mic = add(Track::Kind::Audio, "Microphone", "synthetic");
    mic->tone_hz = 220.0;
  } else {
    if (!config.capture_card_device.empty()) {
      Track* track = add(Track::Kind::Video, "Gameplay", config.capture_card_device);
      track->video_config = {config.capture_card_device, config.capture_width, config.capture_height, config.fps, config.capture_exact_size};
    }
    if (!config.camera_device.empty()) {
      Track* track = add(Track::Kind::Video, "Webcam", config.camera_device);
      track->video_config = {config.camera_device, config.webcam_width, config.webcam_height, config.webcam_fps, false};
    }
    if (!config.game_audio_device.empty()) {
      Track* track = add(Track::Kind::Audio, "Game Audio", config.game_audio_device);
      track->audio_config = {config.game_audio_device, true};
    }
    if (config.microphone_enabled) {
      Track* track = add(Track::Kind::Audio, "Microphone", config.microphone_device);
      track->audio_config = {config.microphone_device, true};
    }
    if (tracks_.empty()) {
      return fail_start("No capture sources are selected. Choose a capture card, camera or microphone first.");
    }
  }

  std::error_code fs_error;
  std::filesystem::create_directories(config.output_directory, fs_error);
  if (fs_error) {
    return fail_start("Cannot create output directory: " + fs_error.message());
  }
  for (auto& track : tracks_) {
    track->file_name = source_file_name(track->name, track->kind == Track::Kind::Video);
    track->file_path = (std::filesystem::path(config.output_directory) / track->file_name).string();
  }
  if (!tracks_.empty()) {
    file_path_ = tracks_.front()->file_path;
  }

  // Open every device first so a missing device fails before any file is created.
  for (auto& track : tracks_) {
    if (track->synthetic) {
      continue;
    }
    std::string source_error;
    if (track->kind == Track::Kind::Video) {
      track->video_source = create_native_video_source();
      VideoSourceInfo source_info;
      if (!track->video_source->open(track->video_config, source_info, source_error)) {
        return fail_start(track->name + ": " + source_error);
      }
      track->width = source_info.width;
      track->height = source_info.height;
      track->fps = static_cast<int>(source_info.fps);
      track->device_name = source_info.device_name;
    } else {
      track->audio_source = create_native_audio_source();
      std::string device_name;
      if (!track->audio_source->open(track->audio_config, device_name, source_error)) {
        return fail_start(track->name + ": " + source_error);
      }
      track->device_name = device_name;
    }
  }

  for (auto& track : tracks_) {
    std::string track_error;
    if (!open_encoder(*track, track_error)) {
      return fail_start(track_error);
    }
  }

  clock_.start();
  running_ = true;
  active_ = true;
  for (auto& track : tracks_) {
    Track* raw = track.get();
    if (raw->synthetic) {
      threads_.emplace_back([this, raw] {
        if (raw->kind == Track::Kind::Video) {
          run_synthetic_video(*raw);
        } else {
          run_synthetic_audio(*raw);
        }
      });
    } else if (raw->kind == Track::Kind::Video) {
      std::string start_error;
      if (!raw->video_source->start([this, raw](void* buffer, std::int64_t host_us) { push_video(*raw, buffer, host_us); }, start_error)) {
        running_ = false;
        active_ = false;
        return fail_start(raw->name + ": " + start_error);
      }
    } else {
      std::string start_error;
      if (!raw->audio_source->start([this, raw](const float* samples, int frames, std::int64_t host_us) { push_audio(*raw, samples, frames, host_us); }, start_error)) {
        running_ = false;
        active_ = false;
        return fail_start(raw->name + ": " + start_error);
      }
    }
  }
  threads_.emplace_back([this] { watch_sources(); });

  std::lock_guard lock(mutex_);
  state_ = RecordingState::Recording;
  return true;
}

void MasterRecorder::watch_sources() {
  while (running_) {
    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    for (auto& track : tracks_) {
      std::string source_error;
      const bool failed = (track->video_source && track->video_source->failed(source_error))
                          || (track->audio_source && track->audio_source->failed(source_error));
      if (failed) {
        fail(track->name + " (" + track->device_name + "): " + source_error);
        return;
      }
    }
  }
}

void MasterRecorder::fail(const std::string& message) {
  std::lock_guard lock(mutex_);
  if (error_.empty()) {
    error_ = message;
  }
  if (state_ == RecordingState::Recording) {
    state_ = RecordingState::Error;
  }
  running_ = false;
}

RecordingInfo MasterRecorder::snapshot_locked() const {
  RecordingInfo result;
  result.state = state_;
  result.file_path = file_path_;
  result.error = error_;
  result.mode = config_.mode;
  result.dropped_video_frames = dropped_video_;
  result.dropped_audio_frames = dropped_audio_;
  const std::int64_t duration_us = active_ ? clock_.now_us() : 0;
  result.duration_ms = duration_us / 1000;
  for (const auto& track : tracks_) {
    const std::string kind = track->kind == Track::Kind::Video ? "video" : "audio";
    (track->kind == Track::Kind::Video ? result.video_tracks : result.audio_tracks).push_back(track->name);
    SourceFile file;
    file.name = track->name;
    file.kind = kind;
    file.path = track->file_path;
    result.source_files.push_back(std::move(file));
    TrackStat stat;
    stat.name = track->name;
    stat.kind = kind;
    stat.device = track->device_name;
    stat.codec = track->encoder != nullptr && track->encoder->codec != nullptr ? track->encoder->codec->name : "";
    stat.frames = track->frames_written;
    stat.start_offset_ms = std::max<std::int64_t>(0, track->start_offset_us) / 1000;
    stat.width = track->width;
    stat.height = track->height;
    stat.sample_rate = track->kind == Track::Kind::Audio ? kSampleRate : 0;
    stat.channels = track->kind == Track::Kind::Audio ? 2 : 0;
    if (track->kind == Track::Kind::Video && duration_us > 0) {
      stat.actual_fps = static_cast<double>(stat.frames) * 1'000'000.0 / static_cast<double>(duration_us);
    }
    result.track_stats.push_back(std::move(stat));
  }
  std::int64_t total_size = 0;
  for (const auto& file : result.source_files) {
    std::error_code size_error;
    const auto size = std::filesystem::file_size(file.path, size_error);
    if (!size_error) {
      total_size += static_cast<std::int64_t>(size);
    }
  }
  result.file_size_bytes = total_size;
  if (duration_us > 0) {
    result.write_mb_per_second = static_cast<double>(result.file_size_bytes) / 1048576.0 / (static_cast<double>(duration_us) / 1e6);
  }
  return result;
}

RecordingInfo MasterRecorder::stop() {
  std::int64_t capture_duration_ms = 0;
  {
    std::lock_guard lock(mutex_);
    if (!active_) {
      return last_result_.state == RecordingState::Idle ? snapshot_locked() : last_result_;
    }
    capture_duration_ms = clock_.now_us() / 1000;
    if (state_ == RecordingState::Recording) {
      state_ = RecordingState::Stopping;
    }
  }

  running_ = false;
  for (auto& track : tracks_) {
    if (track->video_source) {
      track->video_source->stop();
    }
    if (track->audio_source) {
      track->audio_source->stop();
    }
  }
  for (auto& thread : threads_) {
    if (thread.joinable()) {
      thread.join();
    }
  }
  threads_.clear();

  RecordingInfo summary;
  {
    std::lock_guard lock(mutex_);
    summary = snapshot_locked();
  }
  if (std::getenv("CREATOR_DEBUG") != nullptr) {
    for (const auto& track : tracks_) {
      std::fprintf(stderr, "[recorder] %s zero_copy=%d received=%lld written=%lld avg_encode_ms=%.2f\n", track->name.c_str(),
                   track->zero_copy ? 1 : 0, static_cast<long long>(track->frames_received.load()),
                   static_cast<long long>(track->frames_written.load()),
                   track->frames_written > 0 ? track->encode_us.load() / 1000.0 / track->frames_written.load() : 0.0);
    }
  }

  for (auto& track : tracks_) {
    if (track->kind == Track::Kind::Audio) {
      drain_audio(*track, true);
    }
    encode(*track, true);
  }
  for (auto& track : tracks_) {
    if (track->format != nullptr) {
      const int trailer_result = av_write_trailer(track->format);
      if (trailer_result < 0) {
        fail("Could not finalize " + track->file_name + ": " + av_message(trailer_result));
      }
    }
  }
  const std::int64_t duration_ms = capture_duration_ms;
  active_ = false;
  {
    std::lock_guard lock(mutex_);
    summary = snapshot_locked();
    summary.duration_ms = duration_ms;
  }
  cleanup();

  std::lock_guard lock(mutex_);
  state_ = error_.empty() ? RecordingState::Completed : RecordingState::Error;
  summary.state = state_;
  summary.error = error_;
  summary.dropped_video_frames = dropped_video_;
  summary.dropped_audio_frames = dropped_audio_;
  summary.file_path = file_path_;
  summary.mode = config_.mode;
  const auto seconds = static_cast<double>(duration_ms) / 1000.0;
  std::int64_t total_size = 0;
  for (const auto& file : summary.source_files) {
    std::error_code size_error;
    const auto size = std::filesystem::file_size(file.path, size_error);
    if (!size_error) {
      total_size += static_cast<std::int64_t>(size);
    }
  }
  summary.file_size_bytes = total_size;
  summary.write_mb_per_second = seconds > 0 ? static_cast<double>(summary.file_size_bytes) / 1048576.0 / seconds : 0;
  for (auto& stat : summary.track_stats) {
    if (stat.kind == "video" && seconds > 0) {
      stat.actual_fps = static_cast<double>(stat.frames) / seconds;
    }
  }
  last_result_ = summary;
  return summary;
}

RecordingInfo MasterRecorder::info() const {
  std::lock_guard lock(mutex_);
  return active_ ? snapshot_locked() : (last_result_.state == RecordingState::Idle ? snapshot_locked() : last_result_);
}

void MasterRecorder::cleanup() {
  // Each track closes its own output file in its destructor.
  tracks_.clear();
}

}  // namespace creator::core
