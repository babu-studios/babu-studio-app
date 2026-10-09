target_sources(creator_media_core PRIVATE
  capture/avfoundation_capture.mm
)

set_source_files_properties(capture/avfoundation_capture.mm PROPERTIES COMPILE_FLAGS "-fobjc-arc")
set_target_properties(creator_media_core PROPERTIES
  OBJCXX_STANDARD 20
  OBJCXX_STANDARD_REQUIRED ON
)

find_library(AVFOUNDATION_LIB AVFoundation REQUIRED)
find_library(COREMEDIA_LIB CoreMedia REQUIRED)
find_library(COREVIDEO_LIB CoreVideo REQUIRED)
find_library(FOUNDATION_LIB Foundation REQUIRED)
target_link_libraries(creator_media_core PUBLIC
  ${AVFOUNDATION_LIB}
  ${COREMEDIA_LIB}
  ${COREVIDEO_LIB}
  ${FOUNDATION_LIB}
)
