use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const IMAGE_EXTS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "bmp", "webp", "tif", "tiff", "heic", "heif",
    "cr2", "cr3", "nef", "arw", "raf", "rw2", "orf", "dng", "pef", "srw", "x3f",
];

const PREVIEW_EXTS: &[&str] = &["jpg", "jpeg", "png", "webp", "bmp", "gif", "tif", "tiff"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhotoGroup {
    pub basename: String,
    pub files: Vec<PathBuf>,
    pub preview: PathBuf,
}

pub fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| IMAGE_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn is_preview_capable(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| PREVIEW_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn basename_key(path: &Path) -> Option<String> {
    path.file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
}

pub fn group_files(files: Vec<PathBuf>) -> Vec<PhotoGroup> {
    let mut buckets: BTreeMap<String, Vec<PathBuf>> = BTreeMap::new();

    for file in files {
        if !is_image(&file) {
            continue;
        }
        let Some(key) = basename_key(&file) else {
            continue;
        };
        buckets.entry(key).or_default().push(file);
    }

    buckets
        .into_iter()
        .map(|(basename, files)| {
            let preview = files
                .iter()
                .find(|p| is_preview_capable(p))
                .cloned()
                .unwrap_or_else(|| files[0].clone());
            PhotoGroup {
                basename,
                files,
                preview,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn groups_raw_and_jpeg_by_basename_case_insensitive() {
        let files = vec![
            PathBuf::from("/x/IMG_001.CR2"),
            PathBuf::from("/x/img_001.jpg"),
            PathBuf::from("/x/IMG_002.NEF"),
        ];
        let groups = group_files(files);
        assert_eq!(groups.len(), 2);
        let g1 = &groups[0];
        assert_eq!(g1.basename, "img_001");
        assert_eq!(g1.files.len(), 2);
        assert!(g1.preview.extension().unwrap().to_ascii_lowercase() == "jpg");
    }

    #[test]
    fn raw_only_group_uses_raw_as_preview() {
        let files = vec![PathBuf::from("/x/IMG_002.NEF")];
        let groups = group_files(files);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].preview, PathBuf::from("/x/IMG_002.NEF"));
    }

    #[test]
    fn ignores_non_image_files() {
        let files = vec![
            PathBuf::from("/x/notes.txt"),
            PathBuf::from("/x/IMG_001.JPG"),
        ];
        let groups = group_files(files);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].basename, "img_001");
    }

    #[test]
    fn sorts_groups_by_basename() {
        let files = vec![
            PathBuf::from("/x/IMG_002.JPG"),
            PathBuf::from("/x/IMG_001.JPG"),
            PathBuf::from("/x/IMG_003.JPG"),
        ];
        let groups = group_files(files);
        let names: Vec<&str> = groups.iter().map(|g| g.basename.as_str()).collect();
        assert_eq!(names, vec!["img_001", "img_002", "img_003"]);
    }
}
