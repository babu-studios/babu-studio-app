#include "creator/core/media_core.hpp"

#include <stdexcept>
#include <string>

int main() {
  const creator::core::MediaCore media_core;
  if (media_core.handle_command("STATUS") != "READY") {
    return 1;
  }

  try {
    static_cast<void>(media_core.handle_command("UNKNOWN"));
  } catch (const std::invalid_argument&) {
    return 0;
  }

  return 1;
}
