#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <string>

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
constexpr std::int64_t kAudioGapToleranceSamples = kSampleRate / 20;

void release_buffer(void*, std::uint8_t* data) { release_native_video_frame(data); }

}  // namespace

void MasterRecorder::push_video(Track& track, void* pixel_buffer, const std::int64_t host_time_us) {
  if (!running_) {
    return;
  }
  ++track.frames_received;
  std::int64_t pts = (host_time_us - clock_.origin_us()) / 1000;
  if (pts < 0) {
    return;
  }
  const std::int64_t frame_ms = std::max<std::int64_t>(1, 1000 / std::max(1, track.fps));
  if (track.last_pts >= 0) {
    const std::int64_t gap = pts - track.last_pts;
    if (gap > frame_ms * 3 / 2) {
      dropped_video_ += gap / frame_ms - 1;
    }
  }
  pts = std::max(pts, track.last_pts + 1);

  av_frame_unref(track.frame);
  AVFrame* frame = track.frame;
  frame->width = track.width;
  frame->height = track.height;
  if (track.zero_copy) {
    frame->format = AV_PIX_FMT_VIDEOTOOLBOX;
    frame->data[3] = static_cast<std::uint8_t*>(retain_native_video_frame(pixel_buffer));
    frame->buf[0] = av_buffer_create(frame->data[3], 1, release_buffer, nullptr, 0);
    if (frame->buf[0] == nullptr) {
      release_native_video_frame(frame->data[3]);
      frame->data[3] = nullptr;
      fail("Out of memory while queueing a video frame.");
      return;
    }
  } else {
    frame->format = track.encoder->pix_fmt;
    if (av_frame_get_buffer(frame, 0) < 0) {
      av_frame_unref(frame);
      ++dropped_video_;
      return;
    }
    if (track.encoder->pix_fmt == AV_PIX_FMT_NV12) {
      if (!copy_native_video_frame_nv12(pixel_buffer, frame->data[0], frame->linesize[0], frame->data[1],
                                        frame->linesize[1], track.width, track.height)) {
        av_frame_unref(frame);
        ++dropped_video_;
        return;
      }
    } else {
      AVFrame* input = track.input_frame;
      if (input == nullptr || av_frame_make_writable(input) < 0
          || !copy_native_video_frame_nv12(pixel_buffer, input->data[0], input->linesize[0], input->data[1],
                                           input->linesize[1], track.width, track.height)
          || sws_scale(track.sws_context, input->data, input->linesize, 0, track.height, frame->data,
                       frame->linesize) <= 0) {
        av_frame_unref(frame);
        ++dropped_video_;
        return;
      }
    }
  }
  frame->pts = pts;
  track.last_pts = pts;
  if (track.first_pts < 0) {
    track.first_pts = pts;
    track.start_offset_us = std::max<std::int64_t>(0, host_time_us - clock_.origin_us());
  }
  const auto begun = std::chrono::steady_clock::now();
  if (encode(track, false)) {
    ++track.frames_written;
  }
  track.encode_us += std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now() - begun).count();
}

void MasterRecorder::push_audio(Track& track, const float* interleaved, int frames, const std::int64_t host_time_us) {
  if (!running_ || frames <= 0) {
    return;
  }
  std::int64_t pts = (host_time_us - clock_.origin_us()) * kSampleRate / 1'000'000;
  if (pts < 0) {
    const int skip = static_cast<int>(std::min<std::int64_t>(frames, -pts));
    interleaved += 2 * skip;
    frames -= skip;
    pts += skip;
    if (frames <= 0) {
      return;
    }
  }

  if (!track.audio_started) {
    track.audio_started = true;
    track.queue_start_pts = pts;
  } else {
    const std::int64_t expected = track.queue_start_pts + static_cast<std::int64_t>(track.left.size());
    const std::int64_t gap = pts - expected;
    if (gap > kAudioGapToleranceSamples) {
      drain_audio(track, true);
      track.queue_start_pts = pts;
      track.left.clear();
      track.right.clear();
      ++dropped_audio_;
    } else if (gap > 0) {
      track.left.insert(track.left.end(), static_cast<std::size_t>(gap), 0.0F);
      track.right.insert(track.right.end(), static_cast<std::size_t>(gap), 0.0F);
    } else if (gap < -kAudioGapToleranceSamples) {
      const int overlap = static_cast<int>(std::min<std::int64_t>(frames, -gap));
      interleaved += 2 * overlap;
      frames -= overlap;
      ++dropped_audio_;
      if (frames <= 0) {
        return;
      }
    }
  }

  for (int i = 0; i < frames; ++i) {
    track.left.push_back(interleaved[2 * i]);
    track.right.push_back(interleaved[2 * i + 1]);
  }
  if (track.start_offset_us < 0) {
    track.start_offset_us = std::max<std::int64_t>(0, host_time_us - clock_.origin_us());
  }
  drain_audio(track, false);
}

void MasterRecorder::drain_audio(Track& track, const bool flush) {
  while (track.left.size() >= static_cast<std::size_t>(kAudioFrameSamples)
         || (flush && !track.left.empty())) {
    if (av_frame_make_writable(track.frame) < 0) {
      fail("Could not allocate an audio frame.");
      return;
    }
    const std::size_t available = std::min<std::size_t>(track.left.size(), kAudioFrameSamples);
    auto* left = reinterpret_cast<float*>(track.frame->data[0]);
    auto* right = reinterpret_cast<float*>(track.frame->data[1]);
    std::memcpy(left, track.left.data(), available * sizeof(float));
    std::memcpy(right, track.right.data(), available * sizeof(float));
    if (available < static_cast<std::size_t>(kAudioFrameSamples)) {
      std::fill(left + available, left + kAudioFrameSamples, 0.0F);
      std::fill(right + available, right + kAudioFrameSamples, 0.0F);
    }
    track.left.erase(track.left.begin(), track.left.begin() + static_cast<std::ptrdiff_t>(available));
    track.right.erase(track.right.begin(), track.right.begin() + static_cast<std::ptrdiff_t>(available));
    track.frame->pts = track.queue_start_pts;
    track.queue_start_pts += static_cast<std::int64_t>(available);
    if (encode(track, false)) {
      track.frames_written += static_cast<std::int64_t>(available);
    }
  }
}

}  // namespace creator::core
