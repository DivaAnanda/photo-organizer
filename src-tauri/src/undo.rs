use crate::file_ops::FileOp;
use std::path::PathBuf;
use std::sync::Mutex;

const MAX_UNDO: usize = 50;

#[derive(Debug, Clone)]
pub struct UndoEntry {
    pub op: FileOp,
    pub moves: Vec<(PathBuf, PathBuf)>,
}

#[derive(Default)]
pub struct UndoState {
    stack: Mutex<Vec<UndoEntry>>,
}

impl UndoState {
    pub fn push(&self, entry: UndoEntry) {
        let mut s = self.stack.lock().unwrap();
        if s.len() >= MAX_UNDO {
            s.remove(0);
        }
        s.push(entry);
    }

    pub fn pop(&self) -> Option<UndoEntry> {
        self.stack.lock().unwrap().pop()
    }

    pub fn clear(&self) {
        self.stack.lock().unwrap().clear();
    }
}

#[tauri::command]
pub fn clear_undo(undo: tauri::State<'_, UndoState>) {
    undo.clear();
}
