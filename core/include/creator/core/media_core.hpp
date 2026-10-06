#pragma once

#include <string>
#include <string_view>

namespace creator::core {

class MediaCore {
 public:
  [[nodiscard]] std::string handle_command(std::string_view command) const;
};

}  // namespace creator::core
