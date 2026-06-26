use crate::pairing::{group_files, PhotoGroup};
use std::path::PathBuf;

#[tauri::command]
pub fn scan_folder(path: String) -> Result<Vec<PhotoGroup>, String> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    let entries = std::fs::read_dir(&dir).map_err(|e| format!("Failed to read folder: {}", e))?;
    let mut files: Vec<PathBuf> = Vec::new();
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_file() {
            if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                if name.starts_with('.') {
                    continue;
                }
            }
            files.push(p);
        }
    }

    Ok(group_files(files))
}
