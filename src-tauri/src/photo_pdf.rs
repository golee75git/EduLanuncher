use std::fs;
use std::path::{Path, PathBuf};

use lopdf::{Dictionary, Document, Object, Stream};
use tauri::{AppHandle, Manager};

use crate::path_grant;
use crate::pdf_pages::{self, PdfMade};

const MAX_PHOTOS: usize = 20;
const MAX_PHOTO_BYTES: u64 = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 80 * 1024 * 1024;
const MAX_EDGE: u32 = 8_000;
const MAX_PIXELS: u64 = 8_000_000;
const PNG_LONG_EDGE: u32 = 1_600;
const PAGE_LONG_EDGE: f64 = 720.0;

struct PhotoFrame {
    width: u32,
    height: u32,
    channels: u8,
    encoded: bool,
    bytes: Vec<u8>,
}

#[tauri::command]
pub fn photos_to_pdf(app: AppHandle, ids: Vec<String>, title: String) -> Result<PdfMade, String> {
    if ids.is_empty() {
        return Err("사진을 넣어 주세요.".into());
    }
    if ids.len() > MAX_PHOTOS {
        return Err(format!("한 번에 {MAX_PHOTOS}장까지 저장할 수 있습니다."));
    }
    let mut paths = Vec::new();
    let mut frames = Vec::new();
    let mut total = 0u64;
    for id in &ids {
        let path = granted_picture(&app, id)?;
        let len = fs::metadata(&path)
            .map_err(|_| "사진을 읽지 못했습니다.".to_string())?
            .len();
        if len == 0 || len > MAX_PHOTO_BYTES {
            return Err("사진이 너무 큽니다.".into());
        }
        total = total.saturating_add(len);
        if total > MAX_TOTAL_BYTES {
            return Err("사진이 너무 큽니다.".into());
        }
        frames.push(read_photo(&path)?);
        paths.push(path);
    }
    let first = paths.first().ok_or_else(|| "사진을 넣어 주세요.".to_string())?;
    let dir = first.parent().ok_or_else(|| "저장 폴더를 찾지 못했습니다.".to_string())?;
    path_grant::output_dir_allowed(dir).map_err(|text| text.to_string())?;
    let dest = pdf_pages::fresh_pdf(dir, &photo_label(&title, first), &paths)?;
    let mut doc = pdf_pages::empty_shell()?;
    let pages = frames.len() as u32;
    for frame in frames {
        add_photo_page(&mut doc, frame)?;
    }
    let bytes = pdf_pages::save_new(&mut doc, &dest, &paths)?;
    pdf_pages::publish_new(&app, vec![dest], pages, bytes)
}

fn granted_picture(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let book = app.state::<path_grant::GrantBook>();
    let path = path_grant::view_read(&book, id).map_err(|text| text.to_string())?;
    match extension(&path) {
        Some("png" | "jpg" | "jpeg") => Ok(path),
        _ => Err("사진 파일을 넣어 주세요.".into()),
    }
}

fn extension(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?;
    if ext.eq_ignore_ascii_case("png") {
        Some("png")
    } else if ext.eq_ignore_ascii_case("jpg") {
        Some("jpg")
    } else if ext.eq_ignore_ascii_case("jpeg") {
        Some("jpeg")
    } else {
        None
    }
}

fn read_photo(path: &Path) -> Result<PhotoFrame, String> {
    let bytes = fs::read(path).map_err(|_| "사진을 읽지 못했습니다.".to_string())?;
    match extension(path) {
        Some("jpg" | "jpeg") => jpeg_photo(bytes),
        Some("png") => png_photo(bytes),
        _ => Err("사진 파일을 넣어 주세요.".into()),
    }
}

fn photo_label(title: &str, first: &Path) -> String {
    let custom = pdf_pages::tidy_merge_title(title);
    if !custom.is_empty() {
        return format!("{custom}.pdf");
    }
    format!("{}_사진문서.pdf", photo_stem(first))
}

fn photo_stem(path: &Path) -> String {
    let stem = path.file_stem().and_then(|text| text.to_str()).unwrap_or("");
    let clipped: String = stem.chars().take(40).collect();
    if clipped.is_empty() {
        "사진".into()
    } else {
        clipped
    }
}

fn jpeg_photo(bytes: Vec<u8>) -> Result<PhotoFrame, String> {
    let (width, height, channels) = jpeg_frame(&bytes)?;
    Ok(PhotoFrame {
        width,
        height,
        channels,
        encoded: true,
        bytes,
    })
}

fn jpeg_frame(bytes: &[u8]) -> Result<(u32, u32, u8), String> {
    if bytes.len() < 4 || bytes[0] != 0xFF || bytes[1] != 0xD8 {
        return Err("이 사진은 PDF로 담지 못했습니다.".into());
    }
    let mut index = 2usize;
    while index + 1 < bytes.len() {
        if bytes[index] != 0xFF {
            return Err("이 사진은 PDF로 담지 못했습니다.".into());
        }
        while index < bytes.len() && bytes[index] == 0xFF {
            index += 1;
        }
        if index >= bytes.len() {
            break;
        }
        let marker = bytes[index];
        index += 1;
        if marker == 0xD9 || marker == 0xDA {
            break;
        }
        if marker == 0x01 || (0xD0..=0xD7).contains(&marker) {
            continue;
        }
        if index + 1 >= bytes.len() {
            break;
        }
        let len = u16::from_be_bytes([bytes[index], bytes[index + 1]]) as usize;
        if len < 2 || index + len > bytes.len() {
            return Err("이 사진은 PDF로 담지 못했습니다.".into());
        }
        if marker == 0xC0 || marker == 0xC2 {
            if len < 8 {
                return Err("이 사진은 PDF로 담지 못했습니다.".into());
            }
            let height = u16::from_be_bytes([bytes[index + 3], bytes[index + 4]]) as u32;
            let width = u16::from_be_bytes([bytes[index + 5], bytes[index + 6]]) as u32;
            let channels = bytes[index + 7];
            if !(1..=MAX_EDGE).contains(&width) || !(1..=MAX_EDGE).contains(&height) || !matches!(channels, 1 | 3 | 4) {
                return Err("이 사진은 PDF로 담지 못했습니다.".into());
            }
            return Ok((width, height, channels));
        }
        if (0xC1..=0xCF).contains(&marker) {
            return Err("이 사진은 PDF로 담지 못했습니다.".into());
        }
        index += len;
    }
    Err("이 사진은 PDF로 담지 못했습니다.".into())
}

#[cfg(windows)]
fn png_photo(bytes: Vec<u8>) -> Result<PhotoFrame, String> {
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = decoder
        .read_info()
        .map_err(|_| "이 사진은 PDF로 담지 못했습니다.".to_string())?;
    let width = reader.info().width;
    let height = reader.info().height;
    if width == 0 || height == 0 || width > MAX_EDGE || height > MAX_EDGE || u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err("사진이 너무 큽니다.".into());
    }
    let size = reader.output_buffer_size();
    if size > 40 * 1024 * 1024 {
        return Err("사진이 너무 큽니다.".into());
    }
    let mut buf = vec![0u8; size];
    let info = reader
        .next_frame(&mut buf)
        .map_err(|_| "이 사진은 PDF로 담지 못했습니다.".to_string())?;
    let samples = &buf[..info.buffer_size()];
    let (channels, raw) = match info.color_type {
        png::ColorType::Grayscale => (1usize, samples.to_vec()),
        png::ColorType::Rgb => (3usize, samples.to_vec()),
        png::ColorType::GrayscaleAlpha => (1usize, blend_white(samples, 2)),
        png::ColorType::Rgba => (3usize, blend_white(samples, 4)),
        _ => return Err("이 사진은 PDF로 담지 못했습니다.".into()),
    };
    if raw.len() != (width as usize) * (height as usize) * channels {
        return Err("이 사진은 PDF로 담지 못했습니다.".into());
    }
    let (fitted, fit_w, fit_h) = fit_long_edge(&raw, width, height, channels);
    Ok(PhotoFrame {
        width: fit_w,
        height: fit_h,
        channels: channels as u8,
        encoded: false,
        bytes: fitted,
    })
}

#[cfg(not(windows))]
fn png_photo(_bytes: Vec<u8>) -> Result<PhotoFrame, String> {
    Err("이 사진은 PDF로 담지 못했습니다.".into())
}

fn blend_white(samples: &[u8], channels: usize) -> Vec<u8> {
    let color = channels - 1;
    let mut out = Vec::with_capacity(samples.len() / channels * color);
    for pixel in samples.chunks(channels) {
        if pixel.len() < channels {
            break;
        }
        let alpha = u32::from(pixel[color]);
        for sample in pixel.iter().take(color) {
            let mixed = (u32::from(*sample) * alpha + 255 * (255 - alpha)) / 255;
            out.push(mixed as u8);
        }
    }
    out
}

fn fit_long_edge(samples: &[u8], width: u32, height: u32, channels: usize) -> (Vec<u8>, u32, u32) {
    let long = width.max(height);
    if long <= PNG_LONG_EDGE || width == 0 || height == 0 {
        return (samples.to_vec(), width, height);
    }
    let scale = f64::from(PNG_LONG_EDGE) / f64::from(long);
    let next_w = (f64::from(width) * scale).round().max(1.0) as u32;
    let next_h = (f64::from(height) * scale).round().max(1.0) as u32;
    let mut out = vec![0u8; (next_w as usize) * (next_h as usize) * channels];
    for y in 0..next_h {
        let y0 = (u64::from(y) * u64::from(height)) / u64::from(next_h);
        let y1 = ((u64::from(y) + 1) * u64::from(height) / u64::from(next_h)).max(y0 + 1).min(u64::from(height));
        for x in 0..next_w {
            let x0 = (u64::from(x) * u64::from(width)) / u64::from(next_w);
            let x1 = ((u64::from(x) + 1) * u64::from(width) / u64::from(next_w)).max(x0 + 1).min(u64::from(width));
            let mut sum = [0u64; 4];
            let mut count = 0u64;
            for sy in y0..y1 {
                for sx in x0..x1 {
                    let start = ((sy as usize) * (width as usize) + (sx as usize)) * channels;
                    for channel in 0..channels {
                        sum[channel] += u64::from(samples[start + channel]);
                    }
                    count += 1;
                }
            }
            let dest = ((y as usize) * (next_w as usize) + (x as usize)) * channels;
            for channel in 0..channels {
                out[dest + channel] = (sum[channel] / count.max(1)) as u8;
            }
        }
    }
    (out, next_w, next_h)
}

fn add_photo_page(doc: &mut Document, frame: PhotoFrame) -> Result<(), String> {
    let (page_w, page_h) = page_box(frame.width, frame.height);
    let mut image = Dictionary::new();
    image.set("Type", Object::Name(b"XObject".to_vec()));
    image.set("Subtype", Object::Name(b"Image".to_vec()));
    image.set("Width", Object::Integer(i64::from(frame.width)));
    image.set("Height", Object::Integer(i64::from(frame.height)));
    image.set("ColorSpace", Object::Name(color_name(frame.channels).to_vec()));
    image.set("BitsPerComponent", Object::Integer(8));
    if frame.encoded {
        image.set("Filter", Object::Name(b"DCTDecode".to_vec()));
    }
    let mut stream = Stream::new(image, frame.bytes);
    stream.allows_compression = !frame.encoded;
    let image_id = doc.add_object(stream);
    let mut xobjects = Dictionary::new();
    xobjects.set("Im1", Object::Reference(image_id));
    let mut resources = Dictionary::new();
    resources.set("XObject", Object::Dictionary(xobjects));
    let content = format!("q {page_w} 0 0 {page_h} 0 0 cm /Im1 Do Q");
    let content_id = doc.add_object(Stream::new(Dictionary::new(), content.into_bytes()));
    let root = pdf_pages::pages_root(doc)?;
    let mut page = Dictionary::new();
    page.set("Type", Object::Name(b"Page".to_vec()));
    page.set("Parent", Object::Reference(root));
    page.set(
        "MediaBox",
        Object::Array(vec![
            Object::Integer(0),
            Object::Integer(0),
            Object::Integer(page_w),
            Object::Integer(page_h),
        ]),
    );
    page.set("Resources", Object::Dictionary(resources));
    page.set("Contents", Object::Reference(content_id));
    let page_id = doc.add_object(Object::Dictionary(page));
    let mut kids = Vec::new();
    if let Ok(dict) = doc.get_dictionary(root) {
        if let Ok(Object::Array(items)) = dict.get(b"Kids") {
            kids = items.clone();
        }
    }
    kids.push(Object::Reference(page_id));
    let count = kids.len() as i64;
    let dict = doc
        .get_dictionary_mut(root)
        .map_err(|_| "PDF를 만들지 못했습니다.".to_string())?;
    dict.set("Kids", Object::Array(kids));
    dict.set("Count", Object::Integer(count));
    Ok(())
}

fn page_box(width: u32, height: u32) -> (i64, i64) {
    let long = f64::from(width.max(height).max(1));
    let scale = if long > PAGE_LONG_EDGE { PAGE_LONG_EDGE / long } else { 1.0 };
    let page_w = (f64::from(width) * scale).round().max(1.0) as i64;
    let page_h = (f64::from(height) * scale).round().max(1.0) as i64;
    (page_w, page_h)
}

fn color_name(channels: u8) -> &'static [u8] {
    match channels {
        1 => b"DeviceGray",
        4 => b"DeviceCMYK",
        _ => b"DeviceRGB",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tiny_jpeg() -> Vec<u8> {
        let mut bytes = vec![0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00];
        bytes.extend_from_slice(&[0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0x00, 0xFF, 0xD9]);
        bytes
    }

    #[test]
    fn jpeg_frame_reads_size_and_rejects_a_path_title() {
        let (width, height, channels) = jpeg_frame(&tiny_jpeg()).unwrap();
        assert_eq!((width, height, channels), (1, 1, 1));
        assert_eq!(photo_label(r"..\outside", Path::new(r"C:\사진\운동회.jpg")), "운동회_사진문서.pdf");
        assert_eq!(photo_label("회의자료", Path::new(r"C:\사진\운동회.jpg")), "회의자료.pdf");
        assert_eq!(photo_label("", Path::new(r"C:\사진\운동회.jpg")), "운동회_사진문서.pdf");
    }

    #[test]
    fn one_jpeg_becomes_one_pdf_page() {
        let frame = jpeg_photo(tiny_jpeg()).unwrap();
        let mut doc = pdf_pages::empty_shell().unwrap();
        add_photo_page(&mut doc, frame).unwrap();
        let root = pdf_pages::pages_root(&doc).unwrap();
        let count = doc.get_dictionary(root).unwrap().get(b"Count").unwrap();
        assert_eq!(count, &Object::Integer(1));
    }

    #[cfg(windows)]
    #[test]
    fn png_page_keeps_the_pixel_size() {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, 2, 2);
            encoder.set_color(png::ColorType::Rgb);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer
                .write_image_data(&[255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255])
                .unwrap();
            writer.finish().unwrap();
        }
        let frame = png_photo(bytes).unwrap();
        assert_eq!((frame.width, frame.height, frame.channels, frame.encoded), (2, 2, 3, false));
    }
}
