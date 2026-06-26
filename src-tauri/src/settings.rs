use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlotBinding {
    pub key: u8,
    pub folder: Option<String>,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub version: u32,
    pub slots: Vec<SlotBinding>,
    pub last_source_folder: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        let slots = (1u8..=9)
            .map(|k| SlotBinding {
                key: k,
                folder: None,
                label: format!("Slot {}", k),
            })
            .collect();
        Settings {
            version: 1,
            slots,
            last_source_folder: None,
        }
    }
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Cannot resolve config dir: {}", e))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create config dir: {}", e))?;
    Ok(dir.join("settings.json"))
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<Settings, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(Settings::default());
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("Read settings failed: {}", e))?;
    let settings: Settings =
        serde_json::from_slice(&bytes).unwrap_or_else(|_| Settings::default());
    Ok(settings)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    let path = settings_path(&app)?;
    let json = serde_json::to_vec_pretty(&settings)
        .map_err(|e| format!("Serialize settings failed: {}", e))?;
    std::fs::write(&path, json).map_err(|e| format!("Write settings failed: {}", e))?;
    Ok(())
}
