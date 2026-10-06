#include "creator/core/media_core.hpp"

#include <exception>
#include <iostream>
#include <string>

int main() {
  creator::core::MediaCore media_core;
  std::string command;

  while (std::getline(std::cin, command)) {
    try {
      std::cout << media_core.handle_command(command) << '\n' << std::flush;
    } catch (const std::exception& error) {
      std::cerr << error.what() << '\n';
      std::cout << "ERROR\n" << std::flush;
    }
  }

  return 0;
}
