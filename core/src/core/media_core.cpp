#include "creator/core/media_core.hpp"

#include <algorithm>
#include <cstdio>
#include <map>
#include <sstream>
#include <stdexcept>

namespace creator::core {
namespace {

// Mixer levels reach the core as gain factors: 1 is unity, 2 is a full boost.
constexpr double kMaxAudioGain = 2.0;

std::string json_escape(const std::string& value) {
  std::string out;
  for (const char c : value) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (static_cast<unsigned char>(c) < 0x20) {
          char buf[8];
          std::snprintf(buf, sizeof buf, "\\u%04x", c);
          out += buf;
        } else {
          out += c;
        }
    }
  }
  return out;
}

std::string json_array(const std::vector<std::string>& items) {
  std::string out = "[";
  for (std::size_t i = 0; i < items.size(); ++i) {
    out += (i ? ",\"" : "\"") + json_escape(items[i]) + "\"";
  }
  return out + "]";
}

std::string source_files_json(const std::vector<SourceFile>& files) {
  std::ostringstream out;
  for (std::size_t i = 0; i < files.size(); ++i) {
    out << (i ? "," : "") << "{\"name\":\"" << json_escape(files[i].name) << "\",\"kind\":\"" << files[i].kind
        << "\",\"path\":\"" << json_escape(files[i].path) << "\"}";
  }
  return out.str();
}

std::string track_stats_json(const std::vector<TrackStat>& stats) {
  std::ostringstream out;
  for (std::size_t i = 0; i < stats.size(); ++i) {
    out << (i ? "," : "") << "{\"name\":\"" << json_escape(stats[i].name) << "\",\"kind\":\"" << stats[i].kind
        << "\",\"device\":\"" << json_escape(stats[i].device) << "\",\"codec\":\"" << json_escape(stats[i].codec)
        << "\",\"frames\":" << stats[i].frames
        << ",\"actualFps\":" << stats[i].actual_fps
        << ",\"startOffsetMs\":" << stats[i].start_offset_ms
        << ",\"width\":" << stats[i].width
        << ",\"height\":" << stats[i].height
        << ",\"sampleRate\":" << stats[i].sample_rate
        << ",\"channels\":" << stats[i].channels << "}";
  }
  return out.str();
}

std::map<std::string, std::string> parse_fields(std::string_view command) {
  std::map<std::string, std::string> fields;
  std::size_t start = command.find('\t');
  while (start != std::string_view::npos) {
    const std::size_t end = command.find('\t', start + 1);
    const auto field = command.substr(start + 1, end == std::string_view::npos ? end : end - start - 1);
    const auto eq = field.find('=');
    if (eq != std::string_view::npos) {
      fields[std::string(field.substr(0, eq))] = std::string(field.substr(eq + 1));
    }
    start = end;
  }
  return fields;
}

template <typename T, typename Convert>
T field_or(const std::map<std::string, std::string>& fields, const std::string& key, T fallback, Convert convert) {
  const auto it = fields.find(key);
  if (it == fields.end() || it->second.empty()) {
    return fallback;
  }
  try {
    return convert(it->second);
  } catch (const std::exception&) {
    throw std::invalid_argument("Invalid value for " + key);
  }
}

RecordingConfig parse_config(const std::map<std::string, std::string>& fields) {
  RecordingConfig config;
  const auto mode = field_or<std::string>(fields, "mode", "HORIZONTAL", [](const std::string& v) { return v; });
  if (mode == "VERTICAL") {
    config.mode = RecordingMode::Vertical;
  } else if (mode != "HORIZONTAL") {
    throw std::invalid_argument("Unsupported recording mode: " + mode);
  }
  const bool vertical = config.mode == RecordingMode::Vertical;
  config.canvas_width = vertical ? 1080 : 1920;
  config.canvas_height = vertical ? 1920 : 1080;
  const auto to_int = [](const std::string& v) { return std::stoi(v); };
  const auto to_double = [](const std::string& v) { return std::stod(v); };
  config.fps = field_or(fields, "fps", 60, to_int);
  config.webcam_fps = field_or(fields, "webcamFps", 30, to_int);
  config.game_volume = field_or(fields, "gameVolume", 1.0, to_double);
  config.microphone_volume = field_or(fields, "microphoneVolume", 1.0, to_double);
  const auto to_text = [](const std::string& v) { return v; };
  config.capture_card_device = field_or<std::string>(fields, "captureCard", "", to_text);
  config.camera_device = field_or<std::string>(fields, "camera", "", to_text);
  config.game_audio_device = field_or<std::string>(fields, "gameAudio", "", to_text);
  config.microphone_device = field_or<std::string>(fields, "microphone", "", to_text);
  config.microphone_enabled = field_or(fields, "microphoneEnabled", 1, to_int) != 0;
  config.synthetic = field_or(fields, "synthetic", 0, to_int) != 0;
  config.capture_width = field_or(fields, "captureWidth", 1920, to_int);
  config.capture_height = field_or(fields, "captureHeight", 1080, to_int);
  config.capture_exact_size = field_or(fields, "captureExactSize", 1, to_int) != 0;
  config.output_directory = field_or<std::string>(fields, "outputDir", "", [](const std::string& v) { return v; });

  if (config.output_directory.empty()) {
    throw std::invalid_argument("outputDir is required");
  }
  if (config.fps < 1 || config.fps > 120 || config.webcam_fps < 1 || config.webcam_fps > 120) {
    throw std::invalid_argument("Unsupported FPS");
  }
  config.game_volume = std::clamp(config.game_volume, 0.0, kMaxAudioGain);
  config.microphone_volume = std::clamp(config.microphone_volume, 0.0, kMaxAudioGain);
  return config;
}

}  // namespace

std::string recording_info_to_json(const RecordingInfo& info) {
  std::ostringstream out;
  out << "{\"state\":\"" << to_string(info.state) << "\""
      << ",\"success\":" << (info.state == RecordingState::Error ? "false" : "true")
      << ",\"recordingMode\":\"" << to_string(info.mode) << "\""
      << ",\"filePath\":\"" << json_escape(info.file_path) << "\""
      << ",\"sourceFiles\":[" << source_files_json(info.source_files) << "]"
      << ",\"durationMs\":" << info.duration_ms
      << ",\"fileSizeBytes\":" << info.file_size_bytes
      << ",\"droppedVideoFrames\":" << info.dropped_video_frames
      << ",\"droppedAudioFrames\":" << info.dropped_audio_frames
      << ",\"writeMBps\":" << info.write_mb_per_second
      << ",\"trackStats\":[" << track_stats_json(info.track_stats) << "]"
      << ",\"videoTracks\":" << json_array(info.video_tracks)
      << ",\"audioTracks\":" << json_array(info.audio_tracks)
      << ",\"error\":" << (info.error.empty() ? "null" : "\"" + json_escape(info.error) + "\"") << "}";
  return out.str();
}

std::string MediaCore::handle_command(const std::string_view command) {
  const auto name = command.substr(0, command.find('\t'));

  if (name == "STATUS") {
    return "READY";
  }
  if (name == "START_RECORDING") {
    RecordingInfo info;
    try {
      const auto config = parse_config(parse_fields(command));
      std::string error;
      if (!recorder_.start(config, error)) {
        info.state = RecordingState::Error;
        info.error = error;
        info.mode = config.mode;
        return recording_info_to_json(info);
      }
    } catch (const std::invalid_argument& error) {
      info.state = RecordingState::Error;
      info.error = error.what();
      return recording_info_to_json(info);
    }
    return recording_info_to_json(recorder_.info());
  }
  if (name == "LIST_DEVICES") {
    return devices_to_json(list_capture_devices());
  }
  if (name == "STOP_RECORDING") {
    return recording_info_to_json(recorder_.stop());
  }
  if (name == "RECORDING_STATUS") {
    return recording_info_to_json(recorder_.info());
  }

  throw std::invalid_argument("Unsupported media-core command.");
}

}  // namespace creator::core
