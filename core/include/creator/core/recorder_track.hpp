#pragma once

#include <atomic>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/channel_layout.h>
#include <libavutil/error.h>
#include <libavutil/opt.h>
#include <libswscale/swscale.h>
}

#include "creator/core/capture.hpp"
#include "creator/core/recording.hpp"

namespace creator::core {

// Per-source recording state, split out of master_recorder.cpp without any
// behavior change. Each track owns one output file plus its encoder; the
// destructor closes the file, so session teardown needs no format knowledge.
struct MasterRecorder::Track {
  enum class Kind { Video, Audio } kind = Kind::Video;
  bool synthetic = false;
  bool zero_copy = false;
  std::string name;
  std::string file_name;
  std::string file_path;
  AVFormatContext* format = nullptr;
  std::string device_name;
  int width = 0;
  int height = 0;
  int fps = 0;
  double tone_hz = 440.0;
  VideoSourceConfig video_config;
  AudioSourceConfig audio_config;
  std::unique_ptr<NativeVideoSource> video_source;
  std::unique_ptr<NativeAudioSource> audio_source;
  AVCodecContext* encoder = nullptr;
  AVStream* stream = nullptr;
  AVFrame* frame = nullptr;
  AVFrame* input_frame = nullptr;
  AVPacket* packet = nullptr;
  SwsContext* sws_context = nullptr;
  std::int64_t last_pts = -1;
  std::int64_t first_pts = -1;
  std::int64_t start_offset_us = -1;
  std::atomic<std::int64_t> frames_written{0};
  std::atomic<std::int64_t> frames_received{0};
  std::atomic<std::int64_t> encode_us{0};
  // Audio staging: pts (in samples) of the first queued sample.
  bool audio_started = false;
  std::int64_t queue_start_pts = 0;
  std::vector<float> left;
  std::vector<float> right;

  ~Track() {
    if (video_source) {
      video_source->stop();
    }
    if (audio_source) {
      audio_source->stop();
    }
    if (format != nullptr) {
      if (format->pb != nullptr) {
        avio_closep(&format->pb);
      }
      avformat_free_context(format);
      format = nullptr;
    }
    av_frame_free(&frame);
    av_frame_free(&input_frame);
    av_packet_free(&packet);
    avcodec_free_context(&encoder);
    sws_freeContext(sws_context);
  }
};

}  // namespace creator::core
