use exif::{Exif, In, Tag};
use serde::Serialize;
use std::path::Path;

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImageMetadata {
    pub file_name: String,
    pub camera: Option<String>,
    pub lens: Option<String>,
    pub iso: Option<String>,
    pub shutter_speed: Option<String>,
    pub aperture: Option<String>,
    pub focal_length: Option<String>,
    pub exposure_bias: Option<String>,
    pub date_taken: Option<String>,
    pub dimensions: Option<String>,
    pub file_size: Option<String>,
}

fn field_string(exif: &Exif, tag: Tag) -> Option<String> {
    exif.get_field(tag, In::PRIMARY).map(|f| {
        f.display_value()
            .with_unit(exif)
            .to_string()
            .trim_matches('"')
            .trim()
            .to_string()
    })
}

fn human_size(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut size = bytes as f64;
    let mut unit = 0;
    while size >= 1024.0 && unit < UNITS.len() - 1 {
        size /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{} {}", bytes, UNITS[unit])
    } else {
        format!("{:.1} {}", size, UNITS[unit])
    }
}

#[tauri::command]
pub fn read_metadata(path: String) -> Result<ImageMetadata, String> {
    let p = Path::new(&path);
    let mut meta = ImageMetadata {
        file_name: p
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string(),
        ..Default::default()
    };

    if let Ok(m) = std::fs::metadata(p) {
        meta.file_size = Some(human_size(m.len()));
    }

    let file = std::fs::File::open(p).map_err(|e| format!("Open failed: {}", e))?;
    let mut reader = std::io::BufReader::new(&file);
    let exifreader = exif::Reader::new();

    if let Ok(exif) = exifreader.read_from_container(&mut reader) {
        let make = field_string(&exif, Tag::Make);
        let model = field_string(&exif, Tag::Model);
        meta.camera = match (make, model) {
            (Some(mk), Some(md)) => Some(format!("{} {}", mk, md)),
            (Some(mk), None) => Some(mk),
            (None, Some(md)) => Some(md),
            (None, None) => None,
        };
        meta.lens = field_string(&exif, Tag::LensModel);
        meta.iso = field_string(&exif, Tag::PhotographicSensitivity)
            .or_else(|| field_string(&exif, Tag::ISOSpeed));
        meta.shutter_speed = field_string(&exif, Tag::ExposureTime);
        meta.aperture = field_string(&exif, Tag::FNumber).map(|v| {
            if v.starts_with('f') || v.starts_with('F') {
                v
            } else {
                format!("f/{}", v)
            }
        });
        meta.focal_length = field_string(&exif, Tag::FocalLength);
        meta.exposure_bias = field_string(&exif, Tag::ExposureBiasValue);
        meta.date_taken = field_string(&exif, Tag::DateTimeOriginal);
        let w = field_string(&exif, Tag::PixelXDimension);
        let h = field_string(&exif, Tag::PixelYDimension);
        if let (Some(w), Some(h)) = (w, h) {
            meta.dimensions = Some(format!("{} × {}", w, h));
        }
    }

    Ok(meta)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn human_size_formats_units() {
        assert_eq!(human_size(512), "512 B");
        assert_eq!(human_size(2048), "2.0 KB");
        assert_eq!(human_size(5_242_880), "5.0 MB");
    }

    #[test]
    fn read_metadata_returns_filename_without_exif() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("plain.txt");
        std::fs::write(&path, b"not an image").unwrap();
        let meta = read_metadata(path.to_string_lossy().to_string()).unwrap();
        assert_eq!(meta.file_name, "plain.txt");
        assert!(meta.iso.is_none());
        assert!(meta.file_size.is_some());
    }
}
