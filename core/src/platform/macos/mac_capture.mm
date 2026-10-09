#include "creator/core/capture.hpp"

#import <AVFoundation/AVFoundation.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>

#include <algorithm>
#include <atomic>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <vector>
#include <atomic>
#include <mutex>
#include <sstream>

#pragma clang diagnostic ignored "-Wdeprecated-declarations"

namespace creator::core {
namespace {

std::string to_std(NSString* value) {
  return value ? std::string([value UTF8String]) : std::string();
}

std::int64_t cm_time_us(CMTime time) {
  if (!CMTIME_IS_VALID(time)) {
    return 0;
  }
  const CMTime micro = CMTimeConvertScale(time, 1000000, kCMTimeRoundingMethod_Default);
  return micro.value;
}

std::string normalize_device_name(std::string name) {
  while (!name.empty() && std::isspace(static_cast<unsigned char>(name.back()))) {
    name.pop_back();
  }
  if (!name.empty() && name.back() == ')') {
    const auto suffix_start = name.rfind(" (");
    if (suffix_start != std::string::npos) {
      const std::string suffix_label = name.substr(suffix_start);
      std::string normalized_suffix = suffix_label;
      std::transform(normalized_suffix.begin(), normalized_suffix.end(), normalized_suffix.begin(),
                     [](const unsigned char character) {
                       return static_cast<char>(std::tolower(character));
                     });
      const std::string hardware_id = name.substr(suffix_start + 2, name.size() - suffix_start - 3);
      const bool is_vendor_product_id = hardware_id.size() == 9 && hardware_id[4] == ':'
          && std::all_of(hardware_id.begin(), hardware_id.end(), [](const unsigned char character) {
               return character == ':' || std::isxdigit(character);
             });
      if (is_vendor_product_id || normalized_suffix == " (built-in)") {
        name.erase(suffix_start);
      }
    }
  }
  while (!name.empty() && std::isspace(static_cast<unsigned char>(name.back()))) {
    name.pop_back();
  }
  std::transform(name.begin(), name.end(), name.begin(), [](const unsigned char character) {
    return static_cast<char>(std::tolower(character));
  });
  return name;
}

AVCaptureDevice* find_device(AVMediaType type, const std::string& name) {
  NSArray<AVCaptureDevice*>* devices = [AVCaptureDevice devicesWithMediaType:type];
  if (type == AVMediaTypeAudio || type == AVMediaTypeVideo) {
    devices = [devices arrayByAddingObjectsFromArray:[AVCaptureDevice devicesWithMediaType:AVMediaTypeMuxed]];
  }
  NSString* wanted = [NSString stringWithUTF8String:name.c_str()];
  for (AVCaptureDevice* device in devices) {
    if ([device.localizedName isEqualToString:wanted] || [device.uniqueID isEqualToString:wanted]) {
      return device;
    }
  }
  const std::string normalized_wanted = normalize_device_name(name);
  AVCaptureDevice* normalized_match = nil;
  for (AVCaptureDevice* device in devices) {
    if (normalize_device_name(to_std(device.localizedName)) == normalized_wanted) {
      if (normalized_match != nil && ![normalized_match.uniqueID isEqualToString:device.uniqueID]) {
        return nil;
      }
      normalized_match = device;
    }
  }
  if (normalized_match != nil) {
    return normalized_match;
  }
  AVCaptureDevice* partial_match = nil;
  for (AVCaptureDevice* device in devices) {
    if ([device.localizedName rangeOfString:wanted options:NSCaseInsensitiveSearch].location != NSNotFound) {
      if (partial_match != nil && ![partial_match.uniqueID isEqualToString:device.uniqueID]) {
        return nil;
      }
      partial_match = device;
    }
  }
  return partial_match;
}

std::string json_escape(const std::string& value) {
  std::string out;
  for (const char c : value) {
    if (c == '"' || c == '\\') {
      out += '\\';
      out += c;
    } else if (static_cast<unsigned char>(c) < 0x20) {
      out += ' ';
    } else {
      out += c;
    }
  }
  return out;
}

bool check_access(AVMediaType type, const char* label, std::string& error) {
  switch ([AVCaptureDevice authorizationStatusForMediaType:type]) {
    case AVAuthorizationStatusAuthorized:
      return true;
    case AVAuthorizationStatusNotDetermined:
      // Electron normally prompts; this opt-in lets the core be tested standalone.
      if (std::getenv("CREATOR_REQUEST_ACCESS") != nullptr) {
        dispatch_semaphore_t done = dispatch_semaphore_create(0);
        __block BOOL granted = NO;
        [AVCaptureDevice requestAccessForMediaType:type completionHandler:^(BOOL ok) {
          granted = ok;
          dispatch_semaphore_signal(done);
        }];
        dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 60 * NSEC_PER_SEC));
        if (granted) {
          return true;
        }
      }
      error = std::string(label) + " permission has not been granted yet.";
      return false;
    default:
      error = std::string(label) + " permission denied. Enable it in System Settings > Privacy & Security.";
      return false;
  }
}

}  // namespace
}  // namespace creator::core

@interface CRVideoDelegate : NSObject <AVCaptureVideoDataOutputSampleBufferDelegate> {
 @public
  creator::core::VideoFrameCallback callback;
  std::atomic<bool> active;
}
@end

@implementation CRVideoDelegate
- (void)captureOutput:(AVCaptureOutput*)output
    didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer
           fromConnection:(AVCaptureConnection*)connection {
  if (!active.load() || !callback) {
    return;
  }
  CVImageBufferRef image = CMSampleBufferGetImageBuffer(sampleBuffer);
  if (image == nullptr) {
    return;
  }
  callback((void*)image, creator::core::cm_time_us(CMSampleBufferGetPresentationTimeStamp(sampleBuffer)));
}
@end

@interface CRAudioDelegate : NSObject <AVCaptureAudioDataOutputSampleBufferDelegate> {
 @public
  creator::core::AudioChunkCallback callback;
  std::atomic<bool> active;
  std::atomic<bool> format_error;
  std::vector<float> scratch;
}
@end

@implementation CRAudioDelegate
- (void)captureOutput:(AVCaptureOutput*)output
    didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer
           fromConnection:(AVCaptureConnection*)connection {
  if (!active.load() || !callback) {
    return;
  }
  CMAudioFormatDescriptionRef format = CMSampleBufferGetFormatDescription(sampleBuffer);
  const AudioStreamBasicDescription* asbd = format ? CMAudioFormatDescriptionGetStreamBasicDescription(format) : nullptr;
  const bool is_float = asbd && asbd->mFormatID == kAudioFormatLinearPCM && (asbd->mFormatFlags & kAudioFormatFlagIsFloat)
                        && asbd->mBitsPerChannel == 32 && !(asbd->mFormatFlags & kAudioFormatFlagIsNonInterleaved);
  if (!is_float || asbd->mSampleRate != 48000.0 || (asbd->mChannelsPerFrame != 1 && asbd->mChannelsPerFrame != 2)) {
    format_error = true;
    return;
  }
  const int frames = static_cast<int>(CMSampleBufferGetNumSamples(sampleBuffer));
  CMBlockBufferRef block = CMSampleBufferGetDataBuffer(sampleBuffer);
  if (frames <= 0 || block == nullptr) {
    return;
  }
  const int channels = static_cast<int>(asbd->mChannelsPerFrame);
  std::vector<float> raw(static_cast<size_t>(frames) * channels);
  if (CMBlockBufferCopyDataBytes(block, 0, raw.size() * sizeof(float), raw.data()) != kCMBlockBufferNoErr) {
    return;
  }
  if (channels == 2) {
    callback(raw.data(), frames, creator::core::cm_time_us(CMSampleBufferGetPresentationTimeStamp(sampleBuffer)));
    return;
  }
  scratch.resize(static_cast<size_t>(frames) * 2);
  for (int i = 0; i < frames; ++i) {
    scratch[2 * i] = raw[i];
    scratch[2 * i + 1] = raw[i];
  }
  callback(scratch.data(), frames, creator::core::cm_time_us(CMSampleBufferGetPresentationTimeStamp(sampleBuffer)));
}
@end

namespace creator::core {
namespace {

// Watches a session for runtime errors and its device for disconnection.
class SessionWatcher {
 public:
  void attach(AVCaptureSession* session, AVCaptureDevice* device) {
    NSNotificationCenter* center = [NSNotificationCenter defaultCenter];
    auto* state = &failure_;
    auto* message = &message_;
    auto* lock = &lock_;
    observers_ = [NSMutableArray array];
    [observers_ addObject:[center addObserverForName:AVCaptureSessionRuntimeErrorNotification
                                              object:session
                                               queue:nil
                                          usingBlock:^(NSNotification* note) {
      NSError* error = note.userInfo[AVCaptureSessionErrorKey];
      std::lock_guard guard(*lock);
      *message = "Capture session failed: " + to_std(error.localizedDescription);
      *state = true;
    }]];
    [observers_ addObject:[center addObserverForName:AVCaptureDeviceWasDisconnectedNotification
                                              object:device
                                               queue:nil
                                          usingBlock:^(NSNotification*) {
      std::lock_guard guard(*lock);
      *message = "Capture device was disconnected.";
      *state = true;
    }]];
  }

  void detach() {
    for (id observer in observers_) {
      [[NSNotificationCenter defaultCenter] removeObserver:observer];
    }
    observers_ = nil;
  }

  bool failed(std::string& error) const {
    std::lock_guard guard(lock_);
    if (failure_) {
      error = message_;
    }
    return failure_;
  }

 private:
  NSMutableArray* observers_ = nil;
  mutable std::mutex lock_;
  bool failure_ = false;
  std::string message_;
};

class MacVideoSource : public NativeVideoSource {
 public:
  ~MacVideoSource() override { stop(); }

  bool open(const VideoSourceConfig& config, VideoSourceInfo& info, std::string& error) override {
    if (!check_access(AVMediaTypeVideo, "Camera", error)) {
      return false;
    }
    device_ = find_device(AVMediaTypeVideo, config.device_name);
    if (device_ == nil) {
      error = "Video device not found: " + config.device_name;
      return false;
    }

    AVCaptureDeviceFormat* best = nil;
    double best_fps = 0;
    long best_distance = -1;
    for (AVCaptureDeviceFormat* format in device_.formats) {
      const CMVideoDimensions dims = CMVideoFormatDescriptionGetDimensions(format.formatDescription);
      double max_fps = 0;
      for (AVFrameRateRange* range in format.videoSupportedFrameRateRanges) {
        max_fps = std::max(max_fps, range.maxFrameRate);
      }
      const long distance = std::labs(static_cast<long>(dims.width) * dims.height - static_cast<long>(config.width) * config.height);
      const bool exact = dims.width == config.width && dims.height == config.height;
      if (config.exact_size && !exact) {
        continue;
      }
      const bool meets_fps = max_fps + 0.5 >= config.fps;
      const bool better = best == nil || distance < best_distance
          || (distance == best_distance && meets_fps && best_fps + 0.5 < config.fps)
          || (distance == best_distance && meets_fps && max_fps < best_fps && best_fps + 0.5 >= config.fps);
      if (better) {
        best = format;
        best_fps = max_fps;
        best_distance = distance;
      }
    }
    if (best == nil) {
      error = "Unsupported resolution " + std::to_string(config.width) + "x" + std::to_string(config.height)
              + " on " + to_std(device_.localizedName) + ".";
      return false;
    }
    if (config.exact_size && best_fps + 0.5 < config.fps) {
      error = "Unsupported frame rate " + std::to_string(config.fps) + " fps at " + std::to_string(config.width) + "x"
              + std::to_string(config.height) + " on " + to_std(device_.localizedName) + ".";
      return false;
    }

    const int fps = static_cast<int>(std::min<double>(config.fps, best_fps));
    double actual_fps = fps;
    NSError* ns_error = nil;
    session_ = [[AVCaptureSession alloc] init];
    AVCaptureDeviceInput* input = [AVCaptureDeviceInput deviceInputWithDevice:device_ error:&ns_error];
    if (input == nil || ![session_ canAddInput:input]) {
      error = "Cannot open " + to_std(device_.localizedName) + ": " + to_std(ns_error.localizedDescription);
      return false;
    }
    [session_ addInput:input];
    if (![device_ lockForConfiguration:&ns_error]) {
      error = "Cannot configure " + to_std(device_.localizedName) + ": " + to_std(ns_error.localizedDescription);
      return false;
    }
    AVFrameRateRange* chosen = nil;
    for (AVFrameRateRange* range in best.videoSupportedFrameRateRanges) {
      if (chosen == nil || std::fabs(range.maxFrameRate - fps) < std::fabs(chosen.maxFrameRate - fps)) {
        chosen = range;
      }
    }
    CMTime duration = chosen.minFrameDuration;
    if (chosen.maxFrameRate - chosen.minFrameRate > 0.5 && fps >= chosen.minFrameRate && fps <= chosen.maxFrameRate) {
      duration = CMTimeMake(1, fps);
    }
    @try {
      device_.activeFormat = best;
      device_.activeVideoMinFrameDuration = duration;
      device_.activeVideoMaxFrameDuration = duration;
    } @catch (NSException* exception) {
      [device_ unlockForConfiguration];
      error = "Cannot apply the capture format on " + to_std(device_.localizedName) + ": " + to_std(exception.reason);
      return false;
    }
    [device_ unlockForConfiguration];
    actual_fps = std::round(CMTimeGetSeconds(duration) > 0 ? 1.0 / CMTimeGetSeconds(duration) : fps);

    output_ = [[AVCaptureVideoDataOutput alloc] init];
    output_.videoSettings = @{(id)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange)};
    output_.alwaysDiscardsLateVideoFrames = YES;
    delegate_ = [[CRVideoDelegate alloc] init];
    delegate_->active = false;
    queue_ = dispatch_queue_create("creator.capture.video", DISPATCH_QUEUE_SERIAL);
    [output_ setSampleBufferDelegate:delegate_ queue:queue_];
    if (![session_ canAddOutput:output_]) {
      error = "Cannot read frames from " + to_std(device_.localizedName) + ".";
      return false;
    }
    [session_ addOutput:output_];

    const CMVideoDimensions dims = CMVideoFormatDescriptionGetDimensions(best.formatDescription);
    info.device_name = to_std(device_.localizedName);
    info.width = dims.width;
    info.height = dims.height;
    info.fps = actual_fps;
    watcher_.attach(session_, device_);
    return true;
  }

  bool start(VideoFrameCallback callback, std::string& error) override {
    if (session_ == nil) {
      error = "Video source is not open.";
      return false;
    }
    delegate_->callback = std::move(callback);
    delegate_->active = true;
    [session_ startRunning];
    return true;
  }

  void stop() override {
    if (delegate_ != nil) {
      delegate_->active = false;
    }
    if (session_ != nil && session_.isRunning) {
      [session_ stopRunning];
    }
    if (queue_ != nullptr) {
      dispatch_sync(queue_, ^{});
    }
    watcher_.detach();
    if (delegate_ != nil) {
      delegate_->callback = nullptr;
    }
  }

  bool failed(std::string& error) const override { return watcher_.failed(error); }

 private:
  AVCaptureSession* session_ = nil;
  AVCaptureDevice* device_ = nil;
  AVCaptureVideoDataOutput* output_ = nil;
  CRVideoDelegate* delegate_ = nil;
  dispatch_queue_t queue_ = nullptr;
  SessionWatcher watcher_;
};

class MacAudioSource : public NativeAudioSource {
 public:
  ~MacAudioSource() override { stop(); }

  bool open(const AudioSourceConfig& config, std::string& device_name, std::string& error) override {
    if (!check_access(AVMediaTypeAudio, "Microphone", error)) {
      return false;
    }
    device_ = config.device_name.empty() ? nil : find_device(AVMediaTypeAudio, config.device_name);
    if (device_ == nil && (config.require_name || !config.device_name.empty())) {
      error = "Audio device not found: " + (config.device_name.empty() ? std::string("(none selected)") : config.device_name);
      return false;
    }
    if (device_ == nil) {
      device_ = [AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeAudio];
    }
    if (device_ == nil) {
      error = "No audio input device is available.";
      return false;
    }

    NSError* ns_error = nil;
    session_ = [[AVCaptureSession alloc] init];
    AVCaptureDeviceInput* input = [AVCaptureDeviceInput deviceInputWithDevice:device_ error:&ns_error];
    if (input == nil || ![session_ canAddInput:input]) {
      error = "Cannot open " + to_std(device_.localizedName) + ": " + to_std(ns_error.localizedDescription);
      return false;
    }
    [session_ addInput:input];

    output_ = [[AVCaptureAudioDataOutput alloc] init];
    output_.audioSettings = @{
      AVFormatIDKey : @(kAudioFormatLinearPCM),
      AVSampleRateKey : @48000,
      AVNumberOfChannelsKey : @2,
      AVLinearPCMBitDepthKey : @32,
      AVLinearPCMIsFloatKey : @YES,
      AVLinearPCMIsNonInterleaved : @NO,
      AVLinearPCMIsBigEndianKey : @NO,
    };
    delegate_ = [[CRAudioDelegate alloc] init];
    delegate_->active = false;
    delegate_->format_error = false;
    queue_ = dispatch_queue_create("creator.capture.audio", DISPATCH_QUEUE_SERIAL);
    [output_ setSampleBufferDelegate:delegate_ queue:queue_];
    if (![session_ canAddOutput:output_]) {
      error = "Cannot read audio from " + to_std(device_.localizedName) + ".";
      return false;
    }
    [session_ addOutput:output_];
    device_name = to_std(device_.localizedName);
    watcher_.attach(session_, device_);
    return true;
  }

  bool start(AudioChunkCallback callback, std::string& error) override {
    if (session_ == nil) {
      error = "Audio source is not open.";
      return false;
    }
    delegate_->callback = std::move(callback);
    delegate_->active = true;
    [session_ startRunning];
    return true;
  }

  void stop() override {
    if (delegate_ != nil) {
      delegate_->active = false;
    }
    if (session_ != nil && session_.isRunning) {
      [session_ stopRunning];
    }
    if (queue_ != nullptr) {
      dispatch_sync(queue_, ^{});
    }
    watcher_.detach();
    if (delegate_ != nil) {
      delegate_->callback = nullptr;
    }
  }

  bool failed(std::string& error) const override {
    if (delegate_ != nil && delegate_->format_error.load()) {
      error = "Audio device delivers an unsupported format.";
      return true;
    }
    return watcher_.failed(error);
  }

 private:
  AVCaptureSession* session_ = nil;
  AVCaptureDevice* device_ = nil;
  AVCaptureAudioDataOutput* output_ = nil;
  CRAudioDelegate* delegate_ = nil;
  dispatch_queue_t queue_ = nullptr;
  SessionWatcher watcher_;
};

}  // namespace

bool has_media_access(const MediaKind kind, std::string& error) {
  return kind == MediaKind::Video ? check_access(AVMediaTypeVideo, "Camera", error)
                                  : check_access(AVMediaTypeAudio, "Microphone", error);
}

std::vector<DeviceInfo> list_capture_devices() {
  std::vector<DeviceInfo> result;
  NSArray<AVCaptureDevice*>* video = [AVCaptureDevice devicesWithMediaType:AVMediaTypeVideo];
  NSArray<AVCaptureDevice*>* muxed = [AVCaptureDevice devicesWithMediaType:AVMediaTypeMuxed];
  for (AVCaptureDevice* device in [video arrayByAddingObjectsFromArray:muxed]) {
    DeviceInfo info;
    info.id = to_std(device.uniqueID);
    info.name = to_std(device.localizedName);
    info.kind = "video";
    info.has_audio = [device hasMediaType:AVMediaTypeAudio];
    for (AVCaptureDeviceFormat* format in device.formats) {
      const CMVideoDimensions dims = CMVideoFormatDescriptionGetDimensions(format.formatDescription);
      double max_fps = 0;
      for (AVFrameRateRange* range in format.videoSupportedFrameRateRanges) {
        max_fps = std::max(max_fps, range.maxFrameRate);
      }
      bool merged = false;
      for (auto& mode : info.modes) {
        if (mode.width == dims.width && mode.height == dims.height) {
          mode.max_fps = std::max(mode.max_fps, max_fps);
          merged = true;
        }
      }
      if (!merged) {
        info.modes.push_back({dims.width, dims.height, max_fps});
      }
    }
    result.push_back(std::move(info));
  }
  AVCaptureDevice* default_audio = [AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeAudio];
  for (AVCaptureDevice* device in [AVCaptureDevice devicesWithMediaType:AVMediaTypeAudio]) {
    DeviceInfo info;
    info.id = to_std(device.uniqueID);
    info.name = to_std(device.localizedName);
    info.kind = "audio";
    info.has_audio = true;
    info.is_default = [device.uniqueID isEqualToString:default_audio.uniqueID];
    result.push_back(std::move(info));
  }
  return result;
}

std::string devices_to_json(const std::vector<DeviceInfo>& devices) {
  std::ostringstream out;
  out << "[";
  for (std::size_t i = 0; i < devices.size(); ++i) {
    const auto& device = devices[i];
    out << (i ? "," : "") << "{\"id\":\"" << json_escape(device.id) << "\",\"name\":\"" << json_escape(device.name)
        << "\",\"type\":\"" << device.kind << "\",\"isDefault\":" << (device.is_default ? "true" : "false")
        << ",\"hasAudio\":" << (device.has_audio ? "true" : "false") << ",\"modes\":[";
    for (std::size_t m = 0; m < device.modes.size(); ++m) {
      out << (m ? "," : "") << "{\"width\":" << device.modes[m].width << ",\"height\":" << device.modes[m].height
          << ",\"maxFps\":" << device.modes[m].max_fps << "}";
    }
    out << "]}";
  }
  out << "]";
  return out.str();
}

std::unique_ptr<NativeVideoSource> create_native_video_source() { return std::make_unique<MacVideoSource>(); }
std::unique_ptr<NativeAudioSource> create_native_audio_source() { return std::make_unique<MacAudioSource>(); }

void* retain_pixel_buffer(void* pixel_buffer) { return (void*)CVPixelBufferRetain((CVPixelBufferRef)pixel_buffer); }

void release_pixel_buffer(void* pixel_buffer) { CVPixelBufferRelease((CVPixelBufferRef)pixel_buffer); }

bool copy_pixel_buffer_nv12(void* pixel_buffer, std::uint8_t* y, const int y_stride, std::uint8_t* uv, const int uv_stride,
                            const int width, const int height) {
  CVPixelBufferRef buffer = (CVPixelBufferRef)pixel_buffer;
  const OSType format = CVPixelBufferGetPixelFormatType(buffer);
  if (format != kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange && format != kCVPixelFormatType_420YpCbCr8BiPlanarFullRange) {
    return false;
  }
  if (CVPixelBufferLockBaseAddress(buffer, kCVPixelBufferLock_ReadOnly) != kCVReturnSuccess) {
    return false;
  }
  const auto* src_y = static_cast<const std::uint8_t*>(CVPixelBufferGetBaseAddressOfPlane(buffer, 0));
  const auto* src_uv = static_cast<const std::uint8_t*>(CVPixelBufferGetBaseAddressOfPlane(buffer, 1));
  const size_t src_y_stride = CVPixelBufferGetBytesPerRowOfPlane(buffer, 0);
  const size_t src_uv_stride = CVPixelBufferGetBytesPerRowOfPlane(buffer, 1);
  const bool fits = static_cast<int>(CVPixelBufferGetWidth(buffer)) >= width && static_cast<int>(CVPixelBufferGetHeight(buffer)) >= height;
  if (fits) {
    for (int row = 0; row < height; ++row) {
      std::memcpy(y + static_cast<size_t>(row) * y_stride, src_y + row * src_y_stride, static_cast<size_t>(width));
    }
    for (int row = 0; row < height / 2; ++row) {
      std::memcpy(uv + static_cast<size_t>(row) * uv_stride, src_uv + row * src_uv_stride, static_cast<size_t>(width));
    }
  }
  CVPixelBufferUnlockBaseAddress(buffer, kCVPixelBufferLock_ReadOnly);
  return fits;
}

std::int64_t host_time_now_us() { return cm_time_us(CMClockGetTime(CMClockGetHostTimeClock())); }

}  // namespace creator::core
