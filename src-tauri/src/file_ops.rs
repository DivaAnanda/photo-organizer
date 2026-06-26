use crate::pairing::PhotoGroup;
use crate::undo::{UndoEntry, UndoState};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::State;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileOp {
    Move,
    Copy,
}

#[derive(Debug, Serialize)]
pub struct ActionResult {
    pub moved: Vec<(PathBuf, PathBuf)>,
}

pub fn unique_target(dest_dir: &Path, file_name: &str) -> PathBuf {
    let candidate = dest_dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }

    let (stem, ext) = split_name(file_name);
    for n in 1..10_000 {
        let suffix_name = match ext {
            Some(e) => format!("{} ({}).{}", stem, n, e),
            None => format!("{} ({})", stem, n),
        };
        let next = dest_dir.join(&suffix_name);
        if !next.exists() {
            return next;
        }
    }
    dest_dir.join(file_name)
}

fn split_name(name: &str) -> (&str, Option<&str>) {
    match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], Some(&name[i + 1..])),
        _ => (name, None),
    }
}

fn move_file(src: &Path, dst: &Path) -> std::io::Result<()> {
    match std::fs::rename(src, dst) {
        Ok(()) => Ok(()),
        Err(_) => {
            std::fs::copy(src, dst)?;
            std::fs::remove_file(src)?;
            Ok(())
        }
    }
}

fn rollback_partial_moves(moves: &[(PathBuf, PathBuf)]) {
    for (original, new_path) in moves.iter().rev() {
        let _ = std::fs::rename(new_path, original);
    }
}

#[tauri::command]
pub fn apply_action(
    group: PhotoGroup,
    dest_folder: String,
    op: FileOp,
    undo: State<'_, UndoState>,
) -> Result<ActionResult, String> {
    let dest_dir = PathBuf::from(&dest_folder);
    if !dest_dir.is_dir() {
        return Err(format!("Destination is not a folder: {}", dest_folder));
    }

    let mut moves: Vec<(PathBuf, PathBuf)> = Vec::new();

    for src in &group.files {
        let name = src
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or_else(|| format!("Invalid file name: {:?}", src))?;
        let target = unique_target(&dest_dir, name);

        let result = match op {
            FileOp::Move => move_file(src, &target),
            FileOp::Copy => std::fs::copy(src, &target).map(|_| ()),
        };

        if let Err(e) = result {
            if op == FileOp::Move {
                rollback_partial_moves(&moves);
            } else {
                for (_, partial) in &moves {
                    let _ = std::fs::remove_file(partial);
                }
            }
            return Err(format!("Failed on {}: {}", name, e));
        }

        moves.push((src.clone(), target));
    }

    undo.push(UndoEntry {
        op,
        moves: moves.clone(),
    });

    Ok(ActionResult { moved: moves })
}

#[tauri::command]
pub fn undo_last(undo: State<'_, UndoState>) -> Result<Option<ActionResult>, String> {
    let Some(entry) = undo.pop() else {
        return Ok(None);
    };

    let mut restored: Vec<(PathBuf, PathBuf)> = Vec::new();

    match entry.op {
        FileOp::Move => {
            for (original, new_path) in entry.moves.iter().rev() {
                if let Some(parent) = original.parent() {
                    if !parent.exists() {
                        return Err(format!(
                            "Original folder no longer exists: {}",
                            parent.display()
                        ));
                    }
                }
                let restore_target = if original.exists() {
                    let name = original
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or("restored");
                    unique_target(original.parent().unwrap_or(Path::new(".")), name)
                } else {
                    original.clone()
                };
                std::fs::rename(new_path, &restore_target)
                    .map_err(|e| format!("Undo failed on {}: {}", new_path.display(), e))?;
                restored.push((new_path.clone(), restore_target));
            }
        }
        FileOp::Copy => {
            for (_, copy_path) in entry.moves.iter().rev() {
                std::fs::remove_file(copy_path).map_err(|e| {
                    format!("Undo copy delete failed on {}: {}", copy_path.display(), e)
                })?;
                restored.push((copy_path.clone(), copy_path.clone()));
            }
        }
    }

    Ok(Some(ActionResult { moved: restored }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn unique_target_appends_suffix_on_collision() {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join("foo.jpg"), b"").unwrap();
        let next = unique_target(dir.path(), "foo.jpg");
        assert_eq!(next.file_name().unwrap(), "foo (1).jpg");
    }

    #[test]
    fn unique_target_increments_until_free() {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join("foo.jpg"), b"").unwrap();
        std::fs::write(dir.path().join("foo (1).jpg"), b"").unwrap();
        let next = unique_target(dir.path(), "foo.jpg");
        assert_eq!(next.file_name().unwrap(), "foo (2).jpg");
    }

    #[test]
    fn unique_target_handles_no_extension() {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join("README"), b"").unwrap();
        let next = unique_target(dir.path(), "README");
        assert_eq!(next.file_name().unwrap(), "README (1)");
    }
}
