#include <algorithm>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <string>

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/channel_layout.h>
#include <libavutil/error.h>
#include <libavutil/opt.h>
#include <libswscale/swscale.h>
}

#include "creator/core/recording.hpp"

namespace creator::core {
namespace {

constexpr int kSampleRate = 48000;
constexpr int kAudioFrameSamples = 1024;
constexpr std::int64_t kAudioGapToleranceSamples = kSampleRate / 20;
constexpr double kPi = 3.14159265358979323846;

std::string av_message(const int code) {
  char buffer[AV_ERROR_MAX_STRING_SIZE] = {};
  av_strerror(code, buffer, sizeof buffer);
  return buffer;
}

void release_buffer(void*, std::uint8_t* data) { release_native_video_frame(data); }

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

const char* to_string(const RecordingState state) {
  switch (state) {
    case RecordingState::Idle: return "IDLE";
    case RecordingState::Starting: return "STARTING";
    case RecordingState::Recording: return "RECORDING";
    case RecordingState::Stopping: return "STOPPING";
    case RecordingState::Completed: return "COMPLETED";
    case RecordingState::Error: return "ERROR";
  }
  return "ERROR";
}

const char* to_string(const RecordingMode mode) {
  return mode == RecordingMode::Vertical ? "VERTICAL" : "HORIZONTAL";
}

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

MasterRecorder::MasterRecorder() = default;

MasterRecorder::~MasterRecorder() {
  static_cast<void>(stop());
}

bool MasterRecorder::open_encoder(Track& track, std::string& error) {
  const bool video = track.kind == Track::Kind::Video;
  int result = avformat_alloc_output_context2(&track.format, nullptr, video ? "matroska" : "mp4", track.file_path.c_str());
  if (result < 0 || track.format == nullptr) {
    error = "Could not create " + track.file_path + ": " + av_message(result);
    return false;
  }
  const AVCodec* hardware_video_codec = video ? avcodec_find_encoder_by_name("h264_videotoolbox") : nullptr;
  const AVCodec* software_video_codec = video ? avcodec_find_encoder_by_name("libx264") : nullptr;
  if (video && software_video_codec == nullptr) {
    software_video_codec = avcodec_find_encoder(AV_CODEC_ID_H264);
  }
  const AVCodec* codec = video
                             ? (track.synthetic || hardware_video_codec == nullptr ? software_video_codec : hardware_video_codec)
                             : avcodec_find_encoder(AV_CODEC_ID_AAC);
  if (codec == nullptr) {
    error = video ? "Neither VideoToolbox nor a software H.264 encoder is available." : "AAC encoder is unavailable.";
    return false;
  }

  track.stream = avformat_new_stream(track.format, nullptr);
  track.packet = av_packet_alloc();
  if (!track.stream || !track.packet) {
    error = "Out of memory while creating the " + track.name + " track.";
    return false;
  }

  std::string last_error;
  // Native video is first offered to VideoToolbox as raw CVPixelBuffers (zero copy);
  // if that is rejected, frames are copied into NV12 buffers instead.
  const int attempts = video && !track.synthetic && hardware_video_codec != nullptr && software_video_codec != nullptr
                           ? 3
                           : video && !track.synthetic && hardware_video_codec != nullptr ? 2 : 1;
  for (int attempt = 0; attempt < attempts; ++attempt) {
    const AVCodec* attempt_codec = video && !track.synthetic && attempt == 2 ? software_video_codec : codec;
    avcodec_free_context(&track.encoder);
    av_frame_free(&track.frame);
    av_frame_free(&track.input_frame);
    sws_freeContext(track.sws_context);
    track.sws_context = nullptr;
    track.encoder = avcodec_alloc_context3(attempt_codec);
    track.frame = av_frame_alloc();
    if (!track.encoder || !track.frame) {
      error = "Out of memory while creating the " + track.name + " track.";
      return false;
    }
    AVCodecContext* ctx = track.encoder;
    track.zero_copy = false;
    if (video) {
      ctx->width = track.width;
      ctx->height = track.height;
      ctx->time_base = AVRational{1, 1000};
      ctx->framerate = AVRational{track.fps, 1};
      ctx->bit_rate = track.width >= 3840 ? 60'000'000 : track.width >= 1920 ? 30'000'000 : 8'000'000;
      ctx->gop_size = track.fps * 2;
      ctx->max_b_frames = 0;
      ctx->color_range = AVCOL_RANGE_MPEG;
      if (track.synthetic || attempt_codec == software_video_codec) {
        ctx->pix_fmt = AV_PIX_FMT_YUV420P;
        av_opt_set(ctx->priv_data, "preset", "veryfast", 0);
      } else if (attempt == 0) {
        ctx->pix_fmt = AV_PIX_FMT_VIDEOTOOLBOX;
        ctx->sw_pix_fmt = AV_PIX_FMT_NV12;
        track.zero_copy = true;
      } else {
        ctx->pix_fmt = AV_PIX_FMT_NV12;
      }
    } else {
      ctx->sample_fmt = AV_SAMPLE_FMT_FLTP;
      ctx->sample_rate = kSampleRate;
      ctx->bit_rate = 192'000;
      ctx->time_base = AVRational{1, kSampleRate};
      av_channel_layout_default(&ctx->ch_layout, 2);
    }
    if (track.format->oformat->flags & AVFMT_GLOBALHEADER) {
      ctx->flags |= AV_CODEC_FLAG_GLOBAL_HEADER;
    }

    const int result = avcodec_open2(ctx, codec, nullptr);
    if (result < 0) {
      last_error = "Could not open the " + track.name + " encoder: " + av_message(result);
      continue;
    }
    last_error.clear();
    break;
  }
  if (!last_error.empty()) {
    error = last_error;
    return false;
  }

  AVCodecContext* ctx = track.encoder;
  result = avcodec_parameters_from_context(track.stream->codecpar, ctx);
  if (result < 0) {
    error = av_message(result);
    return false;
  }
  if (track.zero_copy) {
    track.stream->codecpar->format = AV_PIX_FMT_NV12;
  }
  track.stream->time_base = ctx->time_base;
  av_dict_set(&track.stream->metadata, "title", track.name.c_str(), 0);

  if (video && !track.zero_copy) {
    track.frame->format = ctx->pix_fmt;
    track.frame->width = ctx->width;
    track.frame->height = ctx->height;
    result = av_frame_get_buffer(track.frame, 0);
    if (result >= 0 && !track.synthetic && ctx->pix_fmt != AV_PIX_FMT_NV12) {
      track.input_frame = av_frame_alloc();
      if (track.input_frame == nullptr) {
        error = "Out of memory while creating the " + track.name + " conversion frame.";
        return false;
      }
      track.input_frame->format = AV_PIX_FMT_NV12;
      track.input_frame->width = ctx->width;
      track.input_frame->height = ctx->height;
      result = av_frame_get_buffer(track.input_frame, 0);
      if (result >= 0) {
        track.sws_context = sws_getContext(ctx->width, ctx->height, AV_PIX_FMT_NV12, ctx->width, ctx->height, ctx->pix_fmt,
                                          SWS_FAST_BILINEAR, nullptr, nullptr, nullptr);
        if (track.sws_context == nullptr) {
          error = "Could not initialize pixel-format conversion for " + track.name + ".";
          return false;
        }
      }
    }
  } else if (!video) {
    track.frame->format = ctx->sample_fmt;
    track.frame->sample_rate = ctx->sample_rate;
    track.frame->nb_samples = kAudioFrameSamples;
    av_channel_layout_copy(&track.frame->ch_layout, &ctx->ch_layout);
    result = av_frame_get_buffer(track.frame, 0);
  }
  if (result < 0) {
    error = av_message(result);
    return false;
  }
  result = avio_open(&track.format->pb, track.file_path.c_str(), AVIO_FLAG_WRITE);
  if (result < 0) {
    error = "Cannot open " + track.file_path + " for writing: " + av_message(result);
    return false;
  }
  result = avformat_write_header(track.format, nullptr);
  if (result < 0) {
    error = "Could not write the header for " + track.file_name + ": " + av_message(result);
    return false;
  }
  return true;
}

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

bool MasterRecorder::encode(Track& track, const bool flush) {
  int result = avcodec_send_frame(track.encoder, flush ? nullptr : track.frame);
  if (result < 0 && result != AVERROR_EOF) {
    fail("Encoder failure on " + track.name + ": " + av_message(result));
    return false;
  }
  while (true) {
    result = avcodec_receive_packet(track.encoder, track.packet);
    if (result == AVERROR(EAGAIN) || result == AVERROR_EOF) {
      return true;
    }
    if (result < 0) {
      fail("Encoder failure on " + track.name + ": " + av_message(result));
      return false;
    }
    av_packet_rescale_ts(track.packet, track.encoder->time_base, track.stream->time_base);
    track.packet->stream_index = track.stream->index;
    std::lock_guard lock(mux_mutex_);
    result = av_interleaved_write_frame(track.format, track.packet);
    if (result < 0) {
      fail("Write failure (disk full or removed?): " + av_message(result));
      return false;
    }
  }
}

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
