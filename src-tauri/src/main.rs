#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::{DateTime, Local};
use image::{DynamicImage, GenericImageView, ImageBuffer, Rgb, RgbImage, RgbaImage};
use libheif_rs::{ColorSpace, HeifContext, RgbChroma};
use lopdf::{Document, Object, ObjectId};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    io::{BufWriter, Write},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
use tauri::Window;
use tempfile::TempPath;
use thiserror::Error;

const VALID_EXTENSIONS: &[&str] = &["pdf", "jpg", "jpeg", "png", "bmp", "gif", "tiff", "webp", "heic"];
const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "bmp", "gif", "tiff", "webp", "heic"];
const IMAGE_RENDER_DPI: f64 = 150.0;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InvoiceFile {
    pub path: String,
    pub file_name: String,
    pub ext: String,
    pub modified_ts: i64,
    pub size: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
pub enum SortMode {
    FileNameAsc,
    ModifiedAsc,
    Custom,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MergeRequest {
    pub folder_path: String,
    pub files: Vec<InvoiceFile>,
    pub sort_mode: SortMode,
    pub output_file_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MergeResult {
    pub success: bool,
    pub output_path: String,
    pub failed_files: Vec<String>,
    pub message: Option<String>,
}

#[derive(Debug, Error)]
pub enum MergeError {
    #[error("未找到任何可合并的文件")]
    NoFiles,
    #[error("指定的文件夹无效")]
    InvalidFolder,
    #[error("读取文件失败: {0}")]
    Io(#[from] std::io::Error),
    #[error("图片解码失败: {0}")]
    Image(String),
    #[error("PDF 处理失败: {0}")]
    Pdf(String),
}

#[tauri::command]
fn scan_folder_cmd(folder_path: String) -> Result<Vec<InvoiceFile>, String> {
    scan_folder(Path::new(&folder_path)).map_err(|err| err.to_string())
}

#[tauri::command]
async fn merge_invoices_cmd(window: Window, req: MergeRequest) -> Result<MergeResult, String> {
    let handle = window.clone();
    tauri::async_runtime::spawn_blocking(move || merge_invoices(&handle, req))
        .await
        .map_err(|err| err.to_string())?
        .map_err(|err| err.to_string())
}

fn scan_folder(path: &Path) -> Result<Vec<InvoiceFile>, MergeError> {
    if !path.exists() || !path.is_dir() {
        return Err(MergeError::InvalidFolder);
    }

    let mut results = Vec::new();
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let meta = entry.metadata()?;
        if !meta.is_file() {
            continue;
        }

        let ext = entry
            .path()
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();

        if !VALID_EXTENSIONS.contains(&ext.as_str()) {
            continue;
        }

        let modified_ts = meta
            .modified()
            .ok()
            .and_then(|mtime| mtime.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs() as i64)
            .unwrap_or_else(|| {
                let now: DateTime<Local> = Local::now();
                now.timestamp()
            });

        let file_name = entry
            .file_name()
            .to_string_lossy()
            .into_owned();

        results.push(InvoiceFile {
            path: entry.path().to_string_lossy().into_owned(),
            file_name,
            ext,
            modified_ts,
            size: meta.len(),
        });
    }

    results.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    Ok(results)
}

fn merge_invoices(window: &Window, mut req: MergeRequest) -> Result<MergeResult, MergeError> {
    let folder_path = PathBuf::from(&req.folder_path);
    if !folder_path.exists() || !folder_path.is_dir() {
        return Err(MergeError::InvalidFolder);
    }
    let folder_real = folder_path.canonicalize()?;

    match req.sort_mode {
        SortMode::FileNameAsc => req
            .files
            .sort_by(|a, b| a.file_name.to_lowercase().cmp(&b.file_name.to_lowercase())),
        SortMode::ModifiedAsc => req.files.sort_by_key(|f| f.modified_ts),
        SortMode::Custom => {}
    }

    let total_files = req.files.len();
    if total_files == 0 {
        return Err(MergeError::NoFiles);
    }

    let mut pdf_inputs = Vec::new();
    let mut temp_paths: Vec<TempPath> = Vec::new();
    let mut failed = Vec::new();

    for (index, file) in req.files.iter().enumerate() {
        emit_progress(window, index, total_files, ProgressPhase::Scan);
        let candidate = PathBuf::from(&file.path);
        if !candidate.exists() {
            failed.push(file.file_name.clone());
            continue;
        }

        let canon = match candidate.canonicalize() {
            Ok(c) => c,
            Err(_) => {
                failed.push(file.file_name.clone());
                continue;
            }
        };

        if !canon.starts_with(&folder_real) {
            failed.push(file.file_name.clone());
            continue;
        }

        let ext = file.ext.to_ascii_lowercase();
        if ext == "pdf" {
            pdf_inputs.push(canon);
        } else if IMAGE_EXTENSIONS.contains(&ext.as_str()) {
            match convert_image_to_pdf(&canon) {
                Ok((path_buf, temp_path)) => {
                    pdf_inputs.push(path_buf);
                    temp_paths.push(temp_path);
                }
                Err(_) => {
                    failed.push(file.file_name.clone());
                    continue;
                }
            }
        } else {
            failed.push(file.file_name.clone());
        }
        emit_progress(window, index + 1, total_files, ProgressPhase::Convert);
    }

    if pdf_inputs.is_empty() {
        return Err(MergeError::NoFiles);
    }

    let output_name = req
        .output_file_name
        .and_then(|name| {
            if name.trim().is_empty() {
                None
            } else if name.to_ascii_lowercase().ends_with(".pdf") {
                Some(name)
            } else {
                Some(format!("{name}.pdf"))
            }
        })
        .unwrap_or_else(|| {
            let now = Local::now();
            format!("merged_invoices_{}.pdf", now.format("%Y%m%d_%H%M"))
        });

    let output_path = folder_real.join(output_name);
    merge_pdf_files(window, &pdf_inputs, &output_path)?;
    emit_progress(window, total_files, total_files, ProgressPhase::Write);

    let message = if failed.is_empty() {
        None
    } else {
        Some(format!("{} 个文件处理失败", failed.len()))
    };

    Ok(MergeResult {
        success: failed.len() < total_files,
        output_path: output_path.to_string_lossy().into_owned(),
        failed_files: failed,
        message,
    })
}

#[derive(Clone, Copy)]
enum ProgressPhase {
    Scan,
    Convert,
    Merge,
    Write,
}

fn emit_progress(window: &Window, current: usize, total: usize, phase: ProgressPhase) {
    #[derive(Serialize, Clone)]
    struct Payload<'a> {
        current: usize,
        total: usize,
        phase: &'a str,
    }

    let phase_label = match phase {
        ProgressPhase::Scan => "scan",
        ProgressPhase::Convert => "convert",
        ProgressPhase::Merge => "merge",
        ProgressPhase::Write => "write",
    };

    let _ = window.emit(
        "merge-progress",
        Payload {
            current,
            total,
            phase: phase_label,
        },
    );
}

fn convert_image_to_pdf(path: &Path) -> Result<(PathBuf, TempPath), MergeError> {
    let image = flatten_transparent(load_dynamic_image(path)?);
    let (doc, page1, layer1) =
        printpdf::PdfDocument::new("Invoice Image", printpdf::Mm(210.0), printpdf::Mm(297.0), "Layer");
    let current_layer = doc.get_page(page1).get_layer(layer1);

    let image_object = printpdf::Image::from_dynamic_image(&image);

    let (img_w, img_h) = image.dimensions();
    let aspect = img_w as f64 / img_h as f64;
    let mut display_w = 210.0;
    let mut display_h = display_w / aspect;
    if display_h > 297.0 {
        display_h = 297.0;
        display_w = display_h * aspect;
    }

    let offset_x = (210.0 - display_w) / 2.0;
    let offset_y = (297.0 - display_h) / 2.0;

    let base_width_pt = (img_w.max(1) as f64 / IMAGE_RENDER_DPI) * 72.0;
    let base_height_pt = (img_h.max(1) as f64 / IMAGE_RENDER_DPI) * 72.0;
    let target_width_pt = (display_w / 25.4) * 72.0;
    let target_height_pt = (display_h / 25.4) * 72.0;
    let scale_x = if base_width_pt == 0.0 {
        1.0
    } else {
        target_width_pt / base_width_pt
    };
    let scale_y = if base_height_pt == 0.0 {
        1.0
    } else {
        target_height_pt / base_height_pt
    };

    image_object.add_to_layer(
        current_layer,
        printpdf::ImageTransform {
            translate_x: Some(printpdf::Mm(offset_x)),
            translate_y: Some(printpdf::Mm(offset_y)),
            rotate: None,
            scale_x: Some(scale_x),
            scale_y: Some(scale_y),
            dpi: Some(IMAGE_RENDER_DPI),
        },
    );

    let temp_file = tempfile::Builder::new()
        .prefix("mc-image-")
        .suffix(".pdf")
        .tempfile()?;
    {
        let mut writer = BufWriter::new(temp_file.as_file());
        doc.save(&mut writer)
        .map_err(|err| MergeError::Pdf(err.to_string()))?;
        writer.flush()?;
    }
    let temp_path = temp_file.into_temp_path();
    let path_buf = temp_path.to_path_buf();
    Ok((path_buf, temp_path))
}

fn load_dynamic_image(path: &Path) -> Result<DynamicImage, MergeError> {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ext == "heic" {
        decode_heic(path)
    } else {
        image::open(path).map_err(|err| MergeError::Image(err.to_string()))
    }
}

fn flatten_transparent(image: DynamicImage) -> DynamicImage {
    match image {
        DynamicImage::ImageRgba8(ref rgba) => DynamicImage::ImageRgb8(flatten_rgba(rgba)),
        DynamicImage::ImageRgba16(ref rgba) => {
            let converted = DynamicImage::ImageRgba16(rgba.clone()).to_rgba8();
            DynamicImage::ImageRgb8(flatten_rgba(&converted))
        }
        _ => image,
    }
}

fn flatten_rgba(buffer: &RgbaImage) -> RgbImage {
    let (width, height) = buffer.dimensions();
    let mut rgb = ImageBuffer::new(width, height);
    for (x, y, pixel) in buffer.enumerate_pixels() {
        let [r, g, b, a] = pixel.0;
        let alpha = (a as f32) / 255.0;
        let out_r = blend_channel(r, alpha);
        let out_g = blend_channel(g, alpha);
        let out_b = blend_channel(b, alpha);
        rgb.put_pixel(x, y, Rgb([out_r, out_g, out_b]));
    }
    rgb
}

fn blend_channel(channel: u8, alpha: f32) -> u8 {
    let value = channel as f32 * alpha + 255.0 * (1.0 - alpha);
    value.round().clamp(0.0, 255.0) as u8
}

fn decode_heic(path: &Path) -> Result<DynamicImage, MergeError> {
    let path_str = path
        .to_str()
        .ok_or_else(|| MergeError::Image("HEIC 路径包含非 UTF-8 字符".into()))?;
    let ctx = HeifContext::read_from_file(path_str).map_err(|err| MergeError::Image(err.to_string()))?;
    let handle = ctx
        .primary_image_handle()
        .map_err(|err| MergeError::Image(err.to_string()))?;

    let image = handle
        .decode(ColorSpace::Rgb(RgbChroma::Rgb), None)
        .map_err(|err| MergeError::Image(err.to_string()))?;

    let plane = image
        .planes()
        .interleaved
        .ok_or_else(|| MergeError::Image("HEIC 缺少 interleaved 通道".into()))?;

    let width = plane.width as usize;
    let height = plane.height as usize;
    let stride = plane.stride;
    let channels = ((plane.bits_per_pixel.max(24) / 8) as usize).min(4).max(3);
    let row_bytes = width * channels;

    if stride < row_bytes {
        return Err(MergeError::Image("HEIC stride 小于行宽".into()));
    }

    let mut buffer = vec![0u8; row_bytes * height];
    for row in 0..height {
        let start = row * stride;
        let end = start + row_bytes;
        let dst_range = row * row_bytes..(row + 1) * row_bytes;
        buffer[dst_range].copy_from_slice(&plane.data[start..end]);
    }

    if channels >= 4 {
        let rgba: RgbaImage = ImageBuffer::from_raw(width as u32, height as u32, buffer)
            .ok_or_else(|| MergeError::Image("无法生成 RGBA 图像".into()))?;
        Ok(DynamicImage::ImageRgba8(rgba))
    } else {
        let rgb: RgbImage = ImageBuffer::from_raw(width as u32, height as u32, buffer)
            .ok_or_else(|| MergeError::Image("无法生成 RGB 图像".into()))?;
        Ok(DynamicImage::ImageRgb8(rgb))
    }
}

fn merge_pdf_files(window: &Window, files: &[PathBuf], output: &Path) -> Result<(), MergeError> {
    if files.is_empty() {
        return Err(MergeError::NoFiles);
    }

    let mut documents_pages: Vec<(ObjectId, Object)> = Vec::new();
    let mut documents_objects: BTreeMap<ObjectId, Object> = BTreeMap::new();
    let mut max_id = 1;
    let mut processed = 0usize;

    for path in files {
        emit_progress(window, processed, files.len(), ProgressPhase::Merge);
        let mut doc = Document::load(path).map_err(|err| MergeError::Pdf(err.to_string()))?;
        if doc.is_encrypted() {
            let _ = doc.decrypt(b"");
        }
        doc.renumber_objects_with(max_id);
        max_id = doc.max_id + 1;

        for (object_id, object) in doc.objects.iter() {
            match object.type_name().unwrap_or("") {
                "Page" => {
                    documents_pages.push((*object_id, object.clone()));
                }
                _ => {
                    documents_objects.insert(*object_id, object.clone());
                }
            }
        }
        processed += 1;
    }

    if documents_pages.is_empty() {
        return Err(MergeError::NoFiles);
    }

    let mut document = Document::with_version("1.5");
    let mut catalog_object: Option<(ObjectId, Object)> = None;
    let mut pages_object: Option<(ObjectId, Object)> = None;

    for (object_id, object) in documents_objects.into_iter() {
        match object.type_name().unwrap_or("") {
            "Catalog" => {
                if catalog_object.is_none() {
                    catalog_object = Some((object_id, object));
                }
            }
            "Pages" => {
                if let Ok(dictionary) = object.as_dict() {
                    let mut dictionary = dictionary.clone();
                    if let Some((_, ref existing)) = pages_object {
                        if let Ok(old_dictionary) = existing.as_dict() {
                            dictionary.extend(old_dictionary);
                        }
                    }
                    pages_object = Some((object_id, Object::Dictionary(dictionary)));
                }
            }
            "Outlines" | "Outline" => {}
            _ => {
                document.objects.insert(object_id, object);
            }
        }
    }

    let (page_id, page_object) = pages_object.ok_or_else(|| MergeError::Pdf("Pages root not found".into()))?;
    let (catalog_id, catalog_obj) =
        catalog_object.ok_or_else(|| MergeError::Pdf("Catalog root not found".into()))?;

    for (object_id, object) in documents_pages.iter() {
        if let Ok(dictionary) = object.as_dict() {
            let mut dictionary = dictionary.clone();
            dictionary.set("Parent", page_id);
            document
                .objects
                .insert(*object_id, Object::Dictionary(dictionary));
        }
    }

    if let Ok(dictionary) = page_object.as_dict() {
        let mut dictionary = dictionary.clone();
        dictionary.set("Count", documents_pages.len() as u32);
        dictionary.set(
            "Kids",
            documents_pages
                .iter()
                .map(|(object_id, _)| Object::Reference(*object_id))
                .collect::<Vec<_>>(),
        );
        document.objects.insert(page_id, Object::Dictionary(dictionary));
    }

    if let Ok(dictionary) = catalog_obj.as_dict() {
        let mut dictionary = dictionary.clone();
        dictionary.set("Pages", page_id);
        dictionary.remove(b"Outlines");
        document.objects.insert(catalog_id, Object::Dictionary(dictionary));
    }

    document.trailer.set("Root", catalog_id);
    document.max_id = document.objects.len() as u32;
    document.renumber_objects();

    document
        .save(output)
        .map_err(|err| MergeError::Pdf(err.to_string()))?;
    emit_progress(window, files.len(), files.len(), ProgressPhase::Merge);
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![scan_folder_cmd, merge_invoices_cmd])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
