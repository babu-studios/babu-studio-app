#include "creator/core/recorder_track.hpp"
#include "creator/core/recording.hpp"

namespace creator::core {

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

MasterRecorder::MasterRecorder() = default;

MasterRecorder::~MasterRecorder() {
  static_cast<void>(stop());
}

}  // namespace creator::core
