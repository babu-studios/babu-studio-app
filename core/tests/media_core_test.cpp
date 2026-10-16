#include "creator/core/media_core.hpp"

#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <string>
#include <thread>

int main() {
  creator::core::MediaCore media_core;
  if (media_core.handle_command("STATUS") != "READY") {
    return 1;
  }

  try {
    static_cast<void>(media_core.handle_command("UNKNOWN"));
  } catch (const std::invalid_argument&) {
    const auto output_directory = std::filesystem::temp_directory_path()
                                  / ("babu-studio-core-test-"
                                     + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    const std::string start_command = "START_RECORDING\tmode=HORIZONTAL\tfps=30\tgameVolume=1\tmicrophoneVolume=1"
                                      "\toutputDir="
                                      + output_directory.string() + "\tfileName=master.mkv\tsynthetic=1";
    const std::string started = media_core.handle_command(start_command);
    if (started.find("\"state\":\"RECORDING\"") == std::string::npos) {
      std::cerr << "Synthetic recording did not start: " << started << '\n';
      return 1;
    }
    const std::string duplicate = media_core.handle_command(start_command);
    if (duplicate.find("\"state\":\"ERROR\"") == std::string::npos
        || duplicate.find("already in progress") == std::string::npos) {
      std::cerr << "A duplicate recording session was not rejected: " << duplicate << '\n';
      static_cast<void>(media_core.handle_command("STOP_RECORDING"));
      std::filesystem::remove_all(output_directory);
      return 1;
    }
    const auto elapsed_start = std::chrono::steady_clock::now();
    std::this_thread::sleep_for(std::chrono::milliseconds(1200));
    const auto elapsed_before_stop = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - elapsed_start).count();
    const std::string stopped = media_core.handle_command("STOP_RECORDING");
    if (stopped.find("\"state\":\"COMPLETED\"") == std::string::npos
        || stopped.find("\"durationMs\":") == std::string::npos
        || stopped.find("\"Gameplay\"") == std::string::npos
        || stopped.find("\"Webcam\"") == std::string::npos
        || stopped.find("\"Game Audio\"") == std::string::npos
        || stopped.find("\"Microphone\"") == std::string::npos
        || stopped.find("\"startOffsetMs\"") == std::string::npos) {
      std::cerr << "Synthetic recording did not finalize correctly: " << stopped << '\n';
      std::filesystem::remove_all(output_directory);
      return 1;
    }
    const auto duration_position = stopped.find("\"durationMs\":") + std::string("\"durationMs\":").size();
    const auto reported_duration_ms = std::stoll(stopped.substr(duration_position));
    if (std::llabs(reported_duration_ms - elapsed_before_stop) > 400) {
      std::cerr << "Reported recording duration included stop/finalization time: " << reported_duration_ms
                << " ms versus " << elapsed_before_stop << " ms observed.\n";
      std::filesystem::remove_all(output_directory);
      return 1;
    }
    const auto master_file = output_directory / "master.mkv";
    if (!std::filesystem::exists(master_file) || std::filesystem::file_size(master_file) == 0) {
      std::cerr << "Synthetic recording did not write a master media file.\n";
      std::filesystem::remove_all(output_directory);
      return 1;
    }
    std::filesystem::remove_all(output_directory);
    return 0;
  }

  return 1;
}
