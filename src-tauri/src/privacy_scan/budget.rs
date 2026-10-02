/// 파일 하나 읽기 한도. 폴더 동시 실행과 시간 제한은 이 단계에 없다.

#[derive(Clone, Copy, Debug)]
pub struct ReadBudget {
    pub max_file_bytes: u64,
    pub max_unzip_bytes: u64,
    pub max_pdf_page_bytes: usize,
    pub max_pages: usize,
    pub min_pdf_chars: usize,
}

impl ReadBudget {
    pub const fn standard() -> Self {
        Self {
            max_file_bytes: 50 * 1024 * 1024,
            max_unzip_bytes: 100 * 1024 * 1024,
            max_pdf_page_bytes: 2 * 1024 * 1024,
            max_pages: 200,
            min_pdf_chars: 8,
        }
    }
}
