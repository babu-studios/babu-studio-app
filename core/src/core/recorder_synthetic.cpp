#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <thread>
#include <vector>

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
constexpr int kAudioFrameSamples = 1024;
constexpr double kPi = 3.14159265358979323846;

}  // namespace

void MasterRecorder::run_synthetic_video(Track& track) {
  const std::int64_t period_us = 1'000'000 / track.fps;
  std::int64_t index = 0;
  const int bar_width = std::max(8, track.width / 32);

  while (running_) {
    const std::int64_t target = period_us * index;
    const std::int64_t now = clock_.now_us();
    if (target > now) {
      std::this_thread::sleep_for(std::chrono::microseconds(target - now));
    }
    if (!running_) {
      break;
    }
    const std::int64_t late = clock_.now_us() - target;
    if (late > period_us) {
      const std::int64_t missed = late / period_us;
      dropped_video_ += missed;
      index += missed;
    }

    if (av_frame_make_writable(track.frame) < 0) {
      fail("Could not allocate a video frame.");
      break;
    }
    AVFrame* frame = track.frame;
    const int shade = static_cast<int>(index % 256);
    for (int y = 0; y < frame->height; ++y) {
      std::fill_n(frame->data[0] + y * frame->linesize[0], frame->width, static_cast<std::uint8_t>(40 + (y * 120) / frame->height));
    }
    const int bar_x = static_cast<int>((index * 8) % std::max(1, frame->width - bar_width));
    for (int y = 0; y < frame->height; ++y) {
      std::fill_n(frame->data[0] + y * frame->linesize[0] + bar_x, bar_width, std::uint8_t{235});
    }
    for (int y = 0; y < frame->height / 2; ++y) {
      std::fill_n(frame->data[1] + y * frame->linesize[1], frame->width / 2, static_cast<std::uint8_t>(128));
      std::fill_n(frame->data[2] + y * frame->linesize[2], frame->width / 2, static_cast<std::uint8_t>(shade));
    }

    const std::int64_t pts = std::max(clock_.now_us() / 1000, track.last_pts + 1);
    track.last_pts = pts;
    frame->pts = pts;
    if (encode(track, false)) {
      ++track.frames_written;
    }
    ++index;
  }
}

void MasterRecorder::run_synthetic_audio(Track& track) {
  constexpr std::int64_t kBlockUs = 1'000'000LL * kAudioFrameSamples / kSampleRate;
  std::int64_t sample_position = 0;
  const std::int64_t base_pts = clock_.now_us() * kSampleRate / 1'000'000;
  std::int64_t blocks = 0;
  std::vector<float> block(static_cast<std::size_t>(kAudioFrameSamples) * 2);
  track.audio_started = false;

  while (running_) {
    const std::int64_t target = kBlockUs * (blocks + 1);
    const std::int64_t now = clock_.now_us();
    if (target > now) {
      std::this_thread::sleep_for(std::chrono::microseconds(target - now));
    }
    if (!running_) {
      break;
    }
    for (int i = 0; i < kAudioFrameSamples; ++i) {
      const float sample = static_cast<float>(0.25 * std::sin(2.0 * kPi * track.tone_hz * (sample_position + i) / kSampleRate));
      block[2 * i] = sample;
      block[2 * i + 1] = sample;
    }
    const std::int64_t host_time_us = clock_.origin_us() + (base_pts + sample_position) * 1'000'000 / kSampleRate;
    sample_position += kAudioFrameSamples;
    ++blocks;
    push_audio(track, block.data(), kAudioFrameSamples, host_time_us);
  }
}

}  // namespace creator::core
