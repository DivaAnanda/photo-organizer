mod file_ops;
mod metadata;
mod pairing;
mod scan;
mod settings;
mod undo;

use undo::UndoState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(UndoState::default())
        .invoke_handler(tauri::generate_handler![
            scan::scan_folder,
            file_ops::apply_action,
            file_ops::undo_last,
            undo::clear_undo,
            settings::load_settings,
            settings::save_settings,
            metadata::read_metadata,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
