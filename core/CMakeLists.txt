cmake_minimum_required(VERSION 3.20)
project(creator_media_core VERSION 0.1.0 LANGUAGES CXX)

include(CTest)

add_library(creator_media_core STATIC
  src/core/media_core.cpp
)
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
