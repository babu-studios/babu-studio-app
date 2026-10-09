cmake_minimum_required(VERSION 3.20)
project(creator_media_core VERSION 0.1.0 LANGUAGES CXX)

if(APPLE)
  enable_language(OBJCXX)
elseif(WIN32)
  message(FATAL_ERROR "Windows native capture is not implemented yet. Add the Media Foundation adapter under platform/windows.")
else()
  message(FATAL_ERROR "The media core currently supports macOS only.")
endif()

include(CTest)

find_package(PkgConfig REQUIRED)
pkg_check_modules(FFMPEG REQUIRED IMPORTED_TARGET libavformat libavcodec libavutil libswscale)

add_library(creator_media_core STATIC
  src/core/media_core.cpp
  src/core/master_recorder.cpp
)
add_subdirectory("${CMAKE_CURRENT_SOURCE_DIR}/../platform/macos"
  "${CMAKE_CURRENT_BINARY_DIR}/platform/macos")
target_link_libraries(creator_media_core PUBLIC PkgConfig::FFMPEG)
target_include_directories(creator_media_core
  PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)
target_compile_features(creator_media_core PUBLIC cxx_std_20)

add_executable(creator-media-core
  src/host/main.cpp
)
target_link_libraries(creator-media-core PRIVATE creator_media_core)
set_target_properties(creator-media-core PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
)

if(BUILD_TESTING)
  add_executable(media_core_test tests/media_core_test.cpp)
  target_link_libraries(media_core_test PRIVATE creator_media_core)
  add_test(NAME media_core_test COMMAND media_core_test)
endif()
