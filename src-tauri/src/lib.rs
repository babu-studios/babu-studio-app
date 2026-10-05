use serde::{Serialize, Deserialize};
use serde_json::Value;
use std::process::Command;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AudioDeviceList {
  input_devices: Vec<String>,
  output_devices: Vec<String>,
}

fn normalize_audio_name(name: &str) -> String {
  name.trim().to_string()
}

fn parse_audio_devices(json: &Value) -> AudioDeviceList {
  let mut input_devices = Vec::new();
  let mut output_devices = Vec::new();

  let items = json
    .get("SPAudioDataType")
    .and_then(Value::as_array)
    .and_then(|entries| entries.first())
    .and_then(|entry| entry.get("_items"))
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default();

  for device in items {
    let device_name = device
      .get("_name")
      .and_then(Value::as_str)
      .map(normalize_audio_name)
      .or_else(|| {
        device
          .get("coreaudio_input_source")
          .and_then(Value::as_str)
          .map(str::to_string)
          .or_else(|| device.get("coreaudio_output_source").and_then(Value::as_str).map(str::to_string))
      })
      .unwrap_or_default();

    if device_name.is_empty() || device_name == "Multiple" {
      continue;
    }

    let transport = device
      .get("coreaudio_device_transport")
      .and_then(Value::as_str)
      .unwrap_or("");
    let device_name_lower = device_name.to_ascii_lowercase();
    let is_virtual = transport.contains("virtual") || device_name_lower.contains("virtual") || device_name_lower.contains("teams audio");
    let is_capture_hardware = device_name_lower.contains("elgato")
      || device_name_lower.contains("owl lite")
      || device_name_lower.contains("capture")
      || device_name_lower.contains("4k s")
      || device_name_lower.contains("usb audio")
      || device_name_lower.contains("usb microphone");
    let is_excluded_mic_device = device_name_lower.contains("microsoft teams")
      || device_name_lower.contains("elgato 4k s")
      || device_name_lower.contains("owl lite audio")
      || device_name_lower.contains("default elgato 4k s");

    let input_count = device
      .get("coreaudio_device_input")
      .and_then(Value::as_u64)
      .unwrap_or(0);

    let output_count = device
      .get("coreaudio_device_output")
      .and_then(Value::as_u64)
      .unwrap_or(0);

    let default_input = device
      .get("coreaudio_default_audio_input_device")
      .and_then(Value::as_str)
      .map(|value| value == "spaudio_yes")
      .unwrap_or(false);

    let default_output = device
      .get("coreaudio_default_audio_output_device")
      .and_then(Value::as_str)
      .map(|value| value == "spaudio_yes")
      .unwrap_or(false);

    let has_input_source = device.get("coreaudio_input_source").and_then(Value::as_str).is_some();
    let has_output_source = device.get("coreaudio_output_source").and_then(Value::as_str).is_some();
    let looks_like_headset = device_name_lower.contains("headphone")
      || device_name_lower.contains("headset")
      || device_name_lower.contains("earbud")
      || device_name_lower.contains("airpods")
      || device_name_lower.contains("microphone");

    let is_real_microphone = !is_virtual
      && !is_capture_hardware
      && !is_excluded_mic_device
      && (input_count > 0 || has_input_source || default_input || looks_like_headset)
      && !device_name_lower.contains("teams audio");

    if is_real_microphone {
      input_devices.push(device_name.clone());
    }

    if !is_virtual && (output_count > 0 || has_output_source || default_output || looks_like_headset) {
      output_devices.push(device_name.clone());
    }
  }

  input_devices.sort();
  output_devices.sort();
  input_devices.dedup();
  output_devices.dedup();

  if input_devices.is_empty() {
    input_devices.push("Built-in Microphone".to_string());
  }

  if output_devices.is_empty() {
    output_devices.push("MacBook Air Speakers".to_string());
  }

  AudioDeviceList {
    input_devices,
    output_devices,
  }
}

#[tauri::command]
fn list_active_audio_devices() -> Result<AudioDeviceList, String> {
  let output = Command::new("system_profiler")
    .args(["-json", "SPAudioDataType"])
    .output()
    .map_err(|error| format!("Failed to query audio devices: {error}"))?;

  if !output.status.success() {
    return Err("Audio discovery command failed".to_string());
  }

  let stdout = String::from_utf8_lossy(&output.stdout);
  let json: Value = serde_json::from_str(&stdout)
    .map_err(|error| format!("Failed to parse audio list: {error}"))?;

  Ok(parse_audio_devices(&json))
}

#[tauri::command]
fn list_active_cameras() -> Result<Vec<String>, String> {
  let output = Command::new("system_profiler")
    .args(["-json", "SPCameraDataType"])
    .output()
    .map_err(|error| format!("Failed to query camera devices: {error}"))?;

  if !output.status.success() {
    return Err("Camera discovery command failed".to_string());
  }

  let stdout = String::from_utf8_lossy(&output.stdout);
  let json: Value = serde_json::from_str(&stdout)
    .map_err(|error| format!("Failed to parse camera list: {error}"))?;

  let devices = json
    .get("SPCameraDataType")
    .and_then(Value::as_array)
    .map(|items| {
      items
        .iter()
        .filter_map(|item| item.get("_name").and_then(Value::as_str).map(str::to_string))
        .filter(|name| !name.contains("OBS") && !name.contains("Meld") && !name.contains("Virtual Camera"))
        .collect::<Vec<_>>()
    })
    .unwrap_or_default();

  if devices.is_empty() {
    return Ok(vec!["FaceTime HD Camera".to_string()]);
  }

  Ok(devices)
}

#[tauri::command]
fn list_active_capture_sources() -> Result<Vec<String>, String> {
  let output = Command::new("system_profiler")
    .args(["-json", "SPDisplaysDataType"])
    .output()
    .map_err(|error| format!("Failed to query display sources: {error}"))?;

  if !output.status.success() {
    return Err("Display source discovery command failed".to_string());
  }

  let stdout = String::from_utf8_lossy(&output.stdout);
  let json: Value = serde_json::from_str(&stdout)
    .map_err(|error| format!("Failed to parse display list: {error}"))?;

  let mut sources = json
    .get("SPDisplaysDataType")
    .and_then(Value::as_array)
    .map(|items| {
      items
        .iter()
        .filter_map(|item| item.get("_name").and_then(Value::as_str).map(str::to_string))
        .map(|name| {
          let normalized = name.trim();
          if normalized == "Color LCD" || normalized == "Built-in Retina Display" || normalized == "Built-in Display" {
            "Laptop Screen".to_string()
          } else {
            normalized.to_string()
          }
        })
        .collect::<Vec<_>>()
    })
    .unwrap_or_default();

  sources.sort();
  sources.dedup();

  if sources.is_empty() {
    return Ok(vec!["Laptop Screen".to_string(), "Elgato 4K S".to_string()]);
  }

  Ok(sources)
}

#[cfg(test)]
mod tests {
  use super::parse_audio_devices;
  use serde_json::json;

  #[test]
  fn parses_active_audio_inputs_and_outputs() {
    let json = json!({
      "SPAudioDataType": [{
        "_items": [
          {
            "_name": "MacBook Air Microphone",
            "coreaudio_device_input": 1,
            "coreaudio_device_transport": "coreaudio_device_type_builtin"
          },
          {
            "_name": "MacBook Air Speakers",
            "coreaudio_device_output": 2,
            "coreaudio_device_transport": "coreaudio_device_type_builtin"
          },
          {
            "_name": "AirPods Pro",
            "coreaudio_input_source": "AirPods Pro",
            "coreaudio_output_source": "AirPods Pro",
            "coreaudio_default_audio_input_device": "spaudio_yes",
            "coreaudio_default_audio_output_device": "spaudio_yes",
            "coreaudio_device_transport": "coreaudio_device_type_usb"
          },
          {
            "_name": "Headphone Mic",
            "coreaudio_device_transport": "coreaudio_device_type_usb"
          },
          {
            "_name": "Microsoft Teams Audio",
            "coreaudio_device_input": 1,
            "coreaudio_device_output": 1,
            "coreaudio_device_transport": "coreaudio_device_type_virtual"
          }
        ]
      }]
    });

    let devices = parse_audio_devices(&json);
    assert!(devices.input_devices.contains(&"MacBook Air Microphone".to_string()));
    assert!(devices.output_devices.contains(&"MacBook Air Speakers".to_string()));
    assert!(devices.input_devices.contains(&"AirPods Pro".to_string()));
    assert!(devices.output_devices.contains(&"AirPods Pro".to_string()));
    assert!(devices.input_devices.contains(&"Headphone Mic".to_string()));
    assert!(!devices.input_devices.iter().any(|item| item.contains("Microsoft Teams")));
    assert!(!devices.output_devices.iter().any(|item| item.contains("Microsoft Teams")));
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      list_active_audio_devices,
      list_active_cameras,
      list_active_capture_sources
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
