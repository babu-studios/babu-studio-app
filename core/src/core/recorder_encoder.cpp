#include <cstdint>
#include <mutex>
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

std::string av_message(const int code) {
  char buffer[AV_ERROR_MAX_STRING_SIZE] = {};
  av_strerror(code, buffer, sizeof buffer);
  return buffer;
}

}  // namespace

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

}  // namespace creator::core
