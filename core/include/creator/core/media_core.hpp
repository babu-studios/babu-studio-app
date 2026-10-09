#pragma once

#include <string>
#include <string_view>

#include "creator/core/recording.hpp"

namespace creator::core {

// Commands (tab-separated fields, one per line):
//   STATUS
//   START_RECORDING\tkey=value...
//   STOP_RECORDING
//   RECORDING_STATUS
class MediaCore {
 public:
  [[nodiscard]] std::string handle_command(std::string_view command);

 private:
  MasterRecorder recorder_;
};

std::string recording_info_to_json(const RecordingInfo& info);

}  // namespace creator::core
