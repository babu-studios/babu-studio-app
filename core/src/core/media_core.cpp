#include "creator/core/media_core.hpp"

#include <stdexcept>

namespace creator::core {

std::string MediaCore::handle_command(const std::string_view command) const {
  if (command == "STATUS") {
    return "READY";
  }

  throw std::invalid_argument("Unsupported media-core command.");
}

}  // namespace creator::core
