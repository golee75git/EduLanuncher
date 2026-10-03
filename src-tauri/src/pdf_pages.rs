use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use lopdf::{Dictionary, Document, Object, ObjectId};
use tauri::{AppHandle, Manager};

use crate::path_grant;

const MAX_FILES: usize = 20;
const MAX_PAGES: usize = 800;
const MAX_BYTES: u64 = 80 * 1024 * 1024;

static STOP: AtomicBool = AtomicBool::new(false);

#[derive(serde::Serialize)]
pub struct PdfGlance {
    pub pages: u32,
    pub signed: bool,
}

#[derive(serde::Deserialize)]
pub struct PdfSlot {
    pub page: u32,
    pub turn: i32,
}

struct SavedPdf {
    paths: Vec<PathBuf>,
    pages: u32,
    bytes: u64,
    signed: bool,
    stopped: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MadeFile {
    pub name: String,
    pub reveal_id: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfMade {
    pub files: Vec<MadeFile>,
    pub pages: u32,
    pub bytes: u64,
    pub signed: bool,
    pub stopped: bool,
}

fn publish(app: &AppHandle, saved: SavedPdf) -> Result<PdfMade, String> {
    let book = app.state::<path_grant::GrantBook>();
    let mut files = Vec::new();
    for path in saved.paths {
        let write_id = path_grant::begin_derived_write(&book, &path).map_err(|text| text.to_string())?;
        let card = match path_grant::finish_made(&book, write_id) {
            Ok(card) => card,
            Err(text) => {
                path_grant::drop_grant(&book, write_id);
                return Err(text.to_string());
            }
        };
        files.push(MadeFile {
            name: card.name,
            reveal_id: card.reveal_id,
        });
    }
    Ok(PdfMade {
        files,
        pages: saved.pages,
        bytes: saved.bytes,
        signed: saved.signed,
        stopped: saved.stopped,
    })
}

#[tauri::command]
pub fn pdf_halt() {
    STOP.store(true, Ordering::Relaxed);
}

fn granted_pdf(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let book = app.state::<path_grant::GrantBook>();
    let path = path_grant::view_read(&book, id).map_err(|text| text.to_string())?;
    let text = path.to_string_lossy().into_owned();
    pdf_file(&text)
}

#[tauri::command]
pub fn pdf_glance(app: AppHandle, id: String) -> Result<PdfGlance, String> {
    let path = granted_pdf(&app, &id)?;
    let doc = open_pdf(&path)?;
    let pages = page_count(&doc)?;
    Ok(PdfGlance {
        pages,
        signed: has_signature(&doc),
    })
}

#[tauri::command]
pub fn pdf_merge(app: AppHandle, ids: Vec<String>) -> Result<PdfMade, String> {
    STOP.store(false, Ordering::Relaxed);
    if ids.is_empty() {
        return Err("PDF 파일을 넣어 주세요.".into());
    }
    if ids.len() > MAX_FILES {
        return Err(format!("한 번에 {MAX_FILES}개까지 합칠 수 있습니다."));
    }
    let sources = ids.iter().map(|id| granted_pdf(&app, id)).collect::<Result<Vec<_>, _>>()?;
    let dir = sources
        .first()
        .and_then(|path| path.parent())
        .ok_or_else(|| "저장 폴더를 찾지 못했습니다.".to_string())?;
    path_grant::output_dir_allowed(dir).map_err(|text| text.to_string())?;
    publish(&app, merge_sources(sources)?)
}

fn merge_sources(sources: Vec<PathBuf>) -> Result<SavedPdf, String> {
    let mut shell = empty_shell()?;
    let mut signed = false;
    let mut total: u32 = 0;
    for source in &sources {
        if STOP.load(Ordering::Relaxed) {
            return Ok(SavedPdf {
                paths: Vec::new(),
                pages: 0,
                bytes: 0,
                signed,
                stopped: true,
            });
        }
        let doc = open_pdf(source)?;
        signed = signed || has_signature(&doc);
        let ids = page_id_list(&doc)?;
        total = total.saturating_add(ids.len() as u32);
        if total as usize > MAX_PAGES {
            return Err(format!("페이지는 {MAX_PAGES}쪽까지 처리할 수 있습니다."));
        }
        import_pages(&mut shell, &doc, &ids)?;
    }
    if total == 0 {
        return Err("합칠 페이지가 없습니다.".into());
    }
    let dir = sources[0]
        .parent()
        .ok_or_else(|| "저장 폴더를 찾지 못했습니다.".to_string())?;
    let dest = fresh_pdf(dir, "합친문서.pdf", &sources)?;
    let bytes = save_new(&mut shell, &dest, &sources)?;
    Ok(SavedPdf {
        paths: vec![dest],
        pages: total,
        bytes,
        signed,
        stopped: false,
    })
}

#[tauri::command]
pub fn pdf_extract(app: AppHandle, id: String, pages: Vec<u32>, each: bool) -> Result<PdfMade, String> {
    STOP.store(false, Ordering::Relaxed);
    let source = granted_pdf(&app, &id)?;
    let dir = source
        .parent()
        .ok_or_else(|| "저장 폴더를 찾지 못했습니다.".to_string())?;
    path_grant::output_dir_allowed(dir).map_err(|text| text.to_string())?;
    publish(&app, extract_saved(source, pages, each)?)
}

fn extract_saved(source: PathBuf, pages: Vec<u32>, each: bool) -> Result<SavedPdf, String> {
    let doc = open_pdf(&source)?;
    let signed = has_signature(&doc);
    let chosen = checked_pages(&doc, &pages)?;
    let dir = source
        .parent()
        .ok_or_else(|| "저장 폴더를 찾지 못했습니다.".to_string())?;
    let stem = file_stem(&source);
    if each {
        let mut made = Vec::new();
        let mut bytes = 0u64;
        for (index, page) in chosen.iter().enumerate() {
            if STOP.load(Ordering::Relaxed) {
                return Ok(SavedPdf {
                    paths: made,
                    pages: index as u32,
                    bytes,
                    signed,
                    stopped: true,
                });
            }
            let mut shell = empty_shell()?;
            let id = id_for_page(&doc, *page)?;
            import_pages(&mut shell, &doc, &[id])?;
            let name = format!("{stem}_{:03}.pdf", index + 1);
            let dest = fresh_pdf(dir, &name, &[source.clone()])?;
            bytes = bytes.saturating_add(save_new(&mut shell, &dest, &[source.clone()])?);
            made.push(dest);
        }
        return Ok(SavedPdf {
            paths: made,
            pages: chosen.len() as u32,
            bytes,
            signed,
            stopped: false,
        });
    }
    let mut shell = empty_shell()?;
    let ids = chosen
        .iter()
        .map(|page| id_for_page(&doc, *page))
        .collect::<Result<Vec<_>, _>>()?;
    import_pages(&mut shell, &doc, &ids)?;
    let label = page_label(&chosen);
    let dest = fresh_pdf(dir, &format!("{stem}_{label}.pdf"), &[source.clone()])?;
    let bytes = save_new(&mut shell, &dest, &[source])?;
    Ok(SavedPdf {
        paths: vec![dest],
        pages: chosen.len() as u32,
        bytes,
        signed,
        stopped: false,
    })
}

#[tauri::command]
pub fn pdf_arrange(app: AppHandle, id: String, slots: Vec<PdfSlot>) -> Result<PdfMade, String> {
    let source = granted_pdf(&app, &id)?;
    let dir = source
        .parent()
        .ok_or_else(|| "저장 폴더를 찾지 못했습니다.".to_string())?;
    path_grant::output_dir_allowed(dir).map_err(|text| text.to_string())?;
    publish(&app, arrange_source(source, slots)?)
}

fn arrange_source(source: PathBuf, slots: Vec<PdfSlot>) -> Result<SavedPdf, String> {
    STOP.store(false, Ordering::Relaxed);
    let doc = open_pdf(&source)?;
    let signed = has_signature(&doc);
    if slots.is_empty() {
        return Err("남길 페이지가 없습니다.".into());
    }
    if slots.len() > MAX_PAGES {
        return Err(format!("페이지는 {MAX_PAGES}쪽까지 처리할 수 있습니다."));
    }
    let mut seen = BTreeSet::new();
    let mut picked = Vec::new();
    for slot in &slots {
        if !seen.insert(slot.page) {
            return Err("같은 페이지가 두 번 있습니다.".into());
        }
        let turn = quarter_turn(slot.turn)?;
        let id = id_for_page(&doc, slot.page)?;
        picked.push((id, turn));
    }
    let mut shell = empty_shell()?;
    let ids: Vec<ObjectId> = picked.iter().map(|(id, _)| *id).collect();
    let new_ids = import_pages(&mut shell, &doc, &ids)?;
    for (new_id, (_, turn)) in new_ids.iter().zip(picked.iter()) {
        set_turn(&mut shell, *new_id, *turn)?;
    }
    let dir = source
        .parent()
        .ok_or_else(|| "저장 폴더를 찾지 못했습니다.".to_string())?;
    let dest = fresh_pdf(dir, &format!("{}_정리.pdf", file_stem(&source)), &[source.clone()])?;
    let bytes = save_new(&mut shell, &dest, &[source])?;
    Ok(SavedPdf {
        paths: vec![dest],
        pages: picked.len() as u32,
        bytes,
        signed,
        stopped: false,
    })
}

fn pdf_file(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path.trim());
    let ext = path
        .extension()
        .and_then(|text| text.to_str())
        .unwrap_or("")
        .eq_ignore_ascii_case("pdf");
    if !ext {
        return Err("PDF 파일만 넣을 수 있습니다.".into());
    }
    let meta = fs::metadata(&path).map_err(|_| "이 PDF 파일을 정상적으로 읽을 수 없습니다.".to_string())?;
    if !meta.is_file() {
        return Err("이 PDF 파일을 정상적으로 읽을 수 없습니다.".into());
    }
    if meta.len() == 0 {
        return Err("이 PDF 파일을 정상적으로 읽을 수 없습니다.".into());
    }
    if meta.len() > MAX_BYTES {
        return Err("PDF가 너무 큽니다.".into());
    }
    let mut header = [0u8; 5];
    let mut file = fs::File::open(&path).map_err(|_| "이 PDF 파일을 정상적으로 읽을 수 없습니다.".to_string())?;
    use std::io::Read;
    file.read_exact(&mut header)
        .map_err(|_| "이 PDF 파일을 정상적으로 읽을 수 없습니다.".to_string())?;
    if &header != b"%PDF-" {
        return Err("이 PDF 파일을 정상적으로 읽을 수 없습니다.".into());
    }
    Ok(path)
}

fn open_pdf(path: &Path) -> Result<Document, String> {
    match Document::load(path) {
        Ok(doc) if doc.is_encrypted() || doc.was_encrypted() => Err(locked_message()),
        Ok(doc) => Ok(doc),
        Err(_) => {
            let locked = Document::load_metadata(path)
                .ok()
                .map(|meta| meta.encrypted)
                .unwrap_or(false);
            if locked {
                Err(locked_message())
            } else {
                Err("이 PDF 파일을 정상적으로 읽을 수 없습니다.".into())
            }
        }
    }
}

fn locked_message() -> String {
    "이 PDF는 암호 또는 보안 설정으로 보호되어 있어 현재 작업을 수행할 수 없습니다.".into()
}

fn page_count(doc: &Document) -> Result<u32, String> {
    let count = page_id_list(doc)?.len();
    if count == 0 {
        return Err("이 PDF 파일을 정상적으로 읽을 수 없습니다.".into());
    }
    if count > MAX_PAGES {
        return Err(format!("페이지는 {MAX_PAGES}쪽까지 처리할 수 있습니다."));
    }
    Ok(count as u32)
}

fn page_id_list(doc: &Document) -> Result<Vec<ObjectId>, String> {
    let pages = doc.get_pages();
    if pages.is_empty() {
        return Err("이 PDF 파일을 정상적으로 읽을 수 없습니다.".into());
    }
    let mut numbers: Vec<u32> = pages.keys().copied().collect();
    numbers.sort_unstable();
    Ok(numbers
        .into_iter()
        .filter_map(|number| pages.get(&number).copied())
        .collect())
}

fn id_for_page(doc: &Document, page: u32) -> Result<ObjectId, String> {
    doc.get_pages()
        .get(&page)
        .copied()
        .ok_or_else(|| format!("{page}페이지는 이 문서에 존재하지 않습니다."))
}

fn checked_pages(doc: &Document, pages: &[u32]) -> Result<Vec<u32>, String> {
    if pages.is_empty() {
        return Err("페이지를 입력해 주세요.".into());
    }
    if pages.len() > MAX_PAGES {
        return Err(format!("페이지는 {MAX_PAGES}쪽까지 처리할 수 있습니다."));
    }
    let mut seen = BTreeSet::new();
    for page in pages {
        if !seen.insert(*page) {
            return Err("같은 페이지가 두 번 있습니다.".into());
        }
        id_for_page(doc, *page)?;
    }
    Ok(pages.to_vec())
}

fn quarter_turn(turn: i32) -> Result<i32, String> {
    if matches!(turn, 0 | 90 | 180 | 270) {
        Ok(turn)
    } else {
        Err("회전 각도가 올바르지 않습니다.".into())
    }
}

fn has_signature(doc: &Document) -> bool {
    if catalog_has_sig(doc) {
        return true;
    }
    let Ok(ids) = page_id_list(doc) else {
        return false;
    };
    ids.into_iter().any(|id| page_has_sig(doc, id))
}

fn catalog_has_sig(doc: &Document) -> bool {
    let Ok(catalog) = doc.catalog() else {
        return false;
    };
    let Ok(form) = catalog.get(b"AcroForm") else {
        return false;
    };
    let form_id = match form {
        Object::Reference(id) => *id,
        Object::Dictionary(_) => return dict_tree_has_sig(doc, form),
        _ => return false,
    };
    let Ok(object) = doc.get_object(form_id) else {
        return false;
    };
    dict_tree_has_sig(doc, object)
}

fn page_has_sig(doc: &Document, page_id: ObjectId) -> bool {
    let Ok(dict) = doc.get_dictionary(page_id) else {
        return false;
    };
    let Ok(annots) = dict.get(b"Annots") else {
        return false;
    };
    dict_tree_has_sig(doc, annots)
}

fn dict_tree_has_sig(doc: &Document, object: &Object) -> bool {
    match object {
        Object::Dictionary(dict) => {
            if name_is(dict.get(b"Subtype").ok(), b"Sig") || name_is(dict.get(b"FT").ok(), b"Sig") {
                return true;
            }
            if let Ok(fields) = dict.get(b"Fields") {
                return dict_tree_has_sig(doc, fields);
            }
            false
        }
        Object::Array(items) => items.iter().any(|item| dict_tree_has_sig(doc, item)),
        Object::Reference(id) => doc
            .get_object(*id)
            .map(|next| dict_tree_has_sig(doc, next))
            .unwrap_or(false),
        _ => false,
    }
}

fn name_is(object: Option<&Object>, expected: &[u8]) -> bool {
    matches!(object, Some(Object::Name(name)) if name.as_slice() == expected)
}

fn empty_shell() -> Result<Document, String> {
    let mut doc = Document::new();
    doc.version = "1.7".to_string();
    let pages_id = doc.new_object_id();
    let catalog_id = doc.new_object_id();
    let mut pages = Dictionary::new();
    pages.set("Type", Object::Name(b"Pages".to_vec()));
    pages.set("Kids", Object::Array(Vec::new()));
    pages.set("Count", Object::Integer(0));
    doc.objects.insert(pages_id, Object::Dictionary(pages));
    let mut catalog = Dictionary::new();
    catalog.set("Type", Object::Name(b"Catalog".to_vec()));
    catalog.set("Pages", Object::Reference(pages_id));
    doc.objects.insert(catalog_id, Object::Dictionary(catalog));
    doc.trailer.set("Root", Object::Reference(catalog_id));
    Ok(doc)
}

fn pages_root(doc: &Document) -> Result<ObjectId, String> {
    let catalog = doc.catalog().map_err(|_| "이 PDF 파일을 정상적으로 읽을 수 없습니다.".to_string())?;
    match catalog.get(b"Pages") {
        Ok(Object::Reference(id)) => Ok(*id),
        _ => Err("이 PDF 파일을 정상적으로 읽을 수 없습니다.".into()),
    }
}

fn import_pages(dest: &mut Document, src: &Document, page_ids: &[ObjectId]) -> Result<Vec<ObjectId>, String> {
    if page_ids.is_empty() {
        return Err("합칠 페이지가 없습니다.".into());
    }
    let closure = object_closure(src, page_ids)?;
    let mut map = BTreeMap::new();
    for old_id in closure.keys() {
        map.insert(*old_id, dest.new_object_id());
    }
    for (old_id, object) in closure {
        let new_id = map[&old_id];
        dest.objects.insert(new_id, rewrite_object(object, &map));
    }
    let new_pages: Vec<ObjectId> = page_ids.iter().map(|id| map[id]).collect();
    let root = pages_root(dest)?;
    for page_id in &new_pages {
        let dict = dest
            .get_dictionary_mut(*page_id)
            .map_err(|_| "이 PDF 파일을 정상적으로 읽을 수 없습니다.".to_string())?;
        dict.set("Parent", Object::Reference(root));
    }
    let mut kids = match dest.get_dictionary(root).and_then(|dict| dict.get(b"Kids")) {
        Ok(Object::Array(items)) => items.clone(),
        _ => Vec::new(),
    };
    for page_id in &new_pages {
        kids.push(Object::Reference(*page_id));
    }
    let count = kids.len() as i64;
    let dict = dest
        .get_dictionary_mut(root)
        .map_err(|_| "이 PDF 파일을 정상적으로 읽을 수 없습니다.".to_string())?;
    dict.set("Kids", Object::Array(kids));
    dict.set("Count", Object::Integer(count));
    Ok(new_pages)
}

fn object_closure(doc: &Document, seeds: &[ObjectId]) -> Result<BTreeMap<ObjectId, Object>, String> {
    let mut pending = seeds.to_vec();
    let mut seen = BTreeSet::new();
    let mut out = BTreeMap::new();
    while let Some(id) = pending.pop() {
        if !seen.insert(id) {
            continue;
        }
        if is_pages_node(doc, id) {
            continue;
        }
        let Some(object) = doc.objects.get(&id).cloned() else {
            continue;
        };
        let skip_parent = is_page_object(&object);
        gather_refs(&object, skip_parent, &mut pending);
        out.insert(id, object);
    }
    if out.is_empty() {
        return Err("이 PDF 파일을 정상적으로 읽을 수 없습니다.".into());
    }
    Ok(out)
}

fn gather_refs(object: &Object, skip_parent: bool, pending: &mut Vec<ObjectId>) {
    match object {
        Object::Reference(id) => pending.push(*id),
        Object::Array(items) => {
            for item in items {
                gather_refs(item, false, pending);
            }
        }
        Object::Dictionary(dict) => gather_dict_refs(dict, skip_parent, pending),
        Object::Stream(stream) => gather_dict_refs(&stream.dict, false, pending),
        _ => {}
    }
}

fn gather_dict_refs(dict: &Dictionary, skip_parent: bool, pending: &mut Vec<ObjectId>) {
    for (key, value) in dict.iter() {
        if skip_parent && key.as_slice() == b"Parent" {
            continue;
        }
        gather_refs(value, false, pending);
    }
}

fn rewrite_object(object: Object, map: &BTreeMap<ObjectId, ObjectId>) -> Object {
    match object {
        Object::Reference(id) => Object::Reference(map.get(&id).copied().unwrap_or(id)),
        Object::Array(items) => Object::Array(items.into_iter().map(|item| rewrite_object(item, map)).collect()),
        Object::Dictionary(dict) => Object::Dictionary(rewrite_dict(dict, map)),
        Object::Stream(mut stream) => {
            stream.dict = rewrite_dict(stream.dict, map);
            Object::Stream(stream)
        }
        other => other,
    }
}

fn rewrite_dict(dict: Dictionary, map: &BTreeMap<ObjectId, ObjectId>) -> Dictionary {
    let mut next = Dictionary::new();
    for (key, value) in dict.into_iter() {
        next.set(key, rewrite_object(value, map));
    }
    next
}

fn is_pages_node(doc: &Document, id: ObjectId) -> bool {
    doc.get_dictionary(id)
        .ok()
        .and_then(|dict| dict.get(b"Type").ok())
        .map(|object| name_is(Some(object), b"Pages"))
        .unwrap_or(false)
}

fn is_page_object(object: &Object) -> bool {
    let Object::Dictionary(dict) = object else {
        return false;
    };
    name_is(dict.get(b"Type").ok(), b"Page")
}

fn set_turn(doc: &mut Document, page_id: ObjectId, turn: i32) -> Result<(), String> {
    let current = doc
        .get_dictionary(page_id)
        .ok()
        .and_then(|dict| dict.get(b"Rotate").ok())
        .and_then(|object| match object {
            Object::Integer(value) => Some(*value),
            _ => None,
        })
        .unwrap_or(0);
    let next = (current + i64::from(turn)).rem_euclid(360);
    let dict = doc
        .get_dictionary_mut(page_id)
        .map_err(|_| "이 PDF 파일을 정상적으로 읽을 수 없습니다.".to_string())?;
    dict.set("Rotate", Object::Integer(next));
    Ok(())
}

fn file_stem(path: &Path) -> String {
    let stem = path
        .file_stem()
        .and_then(|text| text.to_str())
        .unwrap_or("문서");
    let clipped: String = stem.chars().take(40).collect();
    if clipped.is_empty() {
        "문서".into()
    } else {
        clipped
    }
}

fn page_label(pages: &[u32]) -> String {
    let mut parts = Vec::new();
    let mut index = 0;
    while index < pages.len() {
        let start = pages[index];
        let mut end = start;
        while index + 1 < pages.len() && pages[index + 1] == end + 1 {
            index += 1;
            end = pages[index];
        }
        if start == end {
            parts.push(start.to_string());
        } else {
            parts.push(format!("{start}-{end}"));
        }
        index += 1;
    }
    let label = parts.join("_");
    if label.chars().count() > 40 {
        "선택".into()
    } else {
        label
    }
}

fn fresh_pdf(dir: &Path, file_name: &str, sources: &[PathBuf]) -> Result<PathBuf, String> {
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|text| text.to_str())
        .unwrap_or("문서");
    for index in 1..=99 {
        let name = if index == 1 {
            format!("{stem}.pdf")
        } else {
            format!("{stem}_{index}.pdf")
        };
        let candidate = dir.join(name);
        if candidate.exists() {
            continue;
        }
        if sources.iter().any(|source| paths_same(source, &candidate)) {
            continue;
        }
        return Ok(candidate);
    }
    Err("같은 이름의 파일이 너무 많습니다.".into())
}

fn save_new(doc: &mut Document, dest: &Path, sources: &[PathBuf]) -> Result<u64, String> {
    if dest.exists() {
        return Err("이미 있는 파일은 덮어쓰지 않습니다.".into());
    }
    if sources.iter().any(|source| paths_same(source, dest)) {
        return Err("원본 파일은 바꾸지 않습니다.".into());
    }
    let tmp = PathBuf::from(format!("{}.part", dest.display()));
    if tmp.exists() {
        let _ = fs::remove_file(&tmp);
    }
    if doc.save(&tmp).is_err() {
        let _ = fs::remove_file(&tmp);
        return Err("PDF를 저장하지 못했습니다.".into());
    }
    if let Err(err) = fs::rename(&tmp, dest) {
        let _ = fs::remove_file(&tmp);
        return Err(write_error(&err));
    }
    fs::metadata(dest)
        .map(|meta| meta.len())
        .map_err(|_| "저장 결과를 확인하지 못했습니다.".to_string())
}

fn write_error(err: &std::io::Error) -> String {
    match err.kind() {
        std::io::ErrorKind::PermissionDenied => "저장할 권한이 없습니다.".into(),
        std::io::ErrorKind::StorageFull => "저장 공간이 부족합니다.".into(),
        _ => "PDF를 저장하지 못했습니다.".into(),
    }
}

fn paths_same(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => left == right,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blank_file(dir: &Path, name: &str, pages: u32) -> PathBuf {
        let mut doc = empty_shell().unwrap();
        for _ in 0..pages {
            let root = pages_root(&doc).unwrap();
            let id = doc.new_object_id();
            let mut page = Dictionary::new();
            page.set("Type", Object::Name(b"Page".to_vec()));
            page.set("Parent", Object::Reference(root));
            page.set(
                "MediaBox",
                Object::Array(vec![
                    Object::Integer(0),
                    Object::Integer(0),
                    Object::Integer(300),
                    Object::Integer(400),
                ]),
            );
            doc.objects.insert(id, Object::Dictionary(page));
            let mut kids = Vec::new();
            if let Ok(dict) = doc.get_dictionary(root) {
                if let Ok(Object::Array(items)) = dict.get(b"Kids") {
                    kids = items.clone();
                }
            }
            kids.push(Object::Reference(id));
            let count = kids.len() as i64;
            let dict = doc.get_dictionary_mut(root).unwrap();
            dict.set("Kids", Object::Array(kids));
            dict.set("Count", Object::Integer(count));
        }
        let path = dir.join(name);
        doc.save(&path).unwrap();
        path
    }

    #[test]
    fn made_result_json_has_no_path() {
        let made = PdfMade {
            files: vec![MadeFile {
                name: "합친문서.pdf".into(),
                reveal_id: "0000000000000001".into(),
            }],
            pages: 1,
            bytes: 2,
            signed: false,
            stopped: false,
        };
        let json = serde_json::to_string(&made).unwrap();
        assert!(json.contains("합친문서.pdf"));
        assert!(json.contains("revealId"));
        assert!(!json.contains("paths"));
        assert!(!json.contains('\\'));
    }

    #[test]
    fn merge_keeps_source_bytes_and_page_count() {
        let dir = std::env::temp_dir().join(format!("edulauncher-pdf-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let first = blank_file(&dir, "가.pdf", 2);
        let second = blank_file(&dir, "나.pdf", 1);
        let before = fs::read(&first).unwrap();
        let made = merge_sources(vec![first.clone(), second]).unwrap();
        assert_eq!(made.pages, 3);
        assert_eq!(made.paths.len(), 1);
        assert!(!made.stopped);
        let after = fs::read(&first).unwrap();
        assert_eq!(before, after);
        let opened = Document::load(&made.paths[0]).unwrap();
        assert_eq!(opened.get_pages().len(), 3);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn arrange_drops_pages_and_sets_turn() {
        let dir = std::env::temp_dir().join(format!("edulauncher-pdf-turn-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let source = blank_file(&dir, "정리.pdf", 3);
        let before = fs::read(&source).unwrap();
        let made = arrange_source(
            source.clone(),
            vec![PdfSlot { page: 3, turn: 90 }, PdfSlot { page: 1, turn: 180 }],
        )
        .unwrap();
        assert_eq!(made.pages, 2);
        assert_eq!(fs::read(&source).unwrap(), before);
        let opened = Document::load(&made.paths[0]).unwrap();
        let pages = opened.get_pages();
        assert_eq!(pages.len(), 2);
        let first = pages.get(&1).copied().unwrap();
        let rotate = opened.get_dictionary(first).unwrap().get(b"Rotate").unwrap();
        assert_eq!(rotate, &Object::Integer(90));
        let _ = fs::remove_dir_all(&dir);
    }
}
