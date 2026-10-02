//! 검사 결과와 추출 중간 형식.
//! 결과에는 원문, 마스킹 문자열, 파일 이름, 경로를 넣지 않는다.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExtractStatus {
    Complete,
    Partial,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Grade {
    /// 빨강. 점수 기준 이상이거나 즉시 규칙.
    High,
    /// 노랑. 일반 후보나 조합이 있다.
    Possible,
    /// 초록. 완료이고 일반 후보와 조합이 없다.
    Clear,
    /// 일부만 읽었고 일반 후보가 없다. 초록이 아니다.
    Incomplete,
    /// 실패. 화면 문구는 "검사 불가".
    Unavailable,
}

impl Grade {
    pub const fn label(self) -> &'static str {
        match self {
            Self::High => "높음",
            Self::Possible => "가능",
            Self::Clear => "낮음",
            Self::Incomplete => "미완료",
            Self::Unavailable => "검사 불가",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReasonCode {
    Unsupported,
    TooLarge,
    Damaged,
    Encrypted,
    UnzipLimit,
    ScannedPdf,
    WeakPdf,
    DecodeFailed,
    FormulaGap,
    ParserPanic,
    Io,
    Missing,
    TimedOut,
    Denied,
}

impl ReasonCode {
    pub const fn message(self) -> &'static str {
        match self {
            Self::Unsupported => "이 파일 형식은 검사할 수 없습니다.",
            Self::TooLarge => "파일이 검사 한도를 넘습니다.",
            Self::Damaged => "파일을 열 수 없습니다.",
            Self::Encrypted => "암호가 걸려 있어 검사할 수 없습니다.",
            Self::UnzipLimit => "압축을 푸는 한도에 도달했습니다.",
            Self::ScannedPdf => "글자 층이 없어 검사할 수 없습니다.",
            Self::WeakPdf => "문서 일부만 검사되었습니다.",
            Self::DecodeFailed => "문서 일부만 검사되었습니다.",
            Self::FormulaGap => "문서 일부만 검사되었습니다.",
            Self::ParserPanic => "파일을 검사하는 중 문제가 생겼습니다.",
            Self::Io => "파일을 열 수 없습니다.",
            Self::Missing => "파일을 열 수 없습니다.",
            Self::TimedOut => "검사 시간이 넘어 검사할 수 없습니다.",
            Self::Denied => "파일을 열 권한이 없습니다.",
        }
    }
}

pub const PARTIAL_NOTE: &str = "문서 일부만 검사되었습니다.";
pub const REFERENCE_NOTE: &str = "반복되거나 기관용으로 보이는 항목은 참고로만 두었습니다.";
pub const HIDDEN_NOTE: &str = "화면에 보이지 않는 위치에서 후보가 나왔습니다.";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum FindingKind {
    Rrn,
    Account,
    Mobile,
    Landline,
    Email,
    Address,
    Birth,
    Ip,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Body,
    Header,
    Footer,
    Comment,
    Property,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Location {
    Line { line: u32 },
    SheetCell { sheet: u32, row: u32, col: u32 },
    Paragraph { index: u32 },
    TableCell { table: u32, row: u32, col: u32 },
    Page { page: u32, line: u32 },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ColumnKind {
    Name,
    StudentName,
    GuardianName,
    Guardian,
    Phone,
    Email,
    Grade,
    Class,
    Roster,
    Address,
    Birth,
    Staff,
    Sensitive,
}

/// 칸 하나. 원문은 검사 함수 안에서만 살고 결과로 나가지 않는다.
#[derive(Clone)]
pub struct Field {
    pub header: Option<String>,
    pub text: String,
    pub location: Location,
    pub hidden: bool,
}

#[derive(Clone)]
pub struct Record {
    pub location: Location,
    pub role: Role,
    pub hidden: bool,
    pub cells: Vec<Field>,
}

#[derive(Clone)]
pub struct ExtractedDocument {
    pub status: ExtractStatus,
    pub reason: Option<ReasonCode>,
    pub records: Vec<Record>,
}

impl ExtractedDocument {
    pub fn failed(reason: ReasonCode) -> Self {
        Self {
            status: ExtractStatus::Failed,
            reason: Some(reason),
            records: Vec::new(),
        }
    }

    pub fn complete(records: Vec<Record>) -> Self {
        Self {
            status: ExtractStatus::Complete,
            reason: None,
            records,
        }
    }

    pub fn partial(reason: ReasonCode, records: Vec<Record>) -> Self {
        Self {
            status: ExtractStatus::Partial,
            reason: Some(reason),
            records,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TypeCount {
    pub kind: FindingKind,
    pub count: u32,
    pub hidden: u32,
    pub locations: Vec<Location>,
    pub overflow: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ComboCount {
    pub label: &'static str,
    pub records: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScanResult {
    pub status: ExtractStatus,
    pub grade: Grade,
    pub partial_note: Option<&'static str>,
    pub reason: Option<ReasonCode>,
    pub types: Vec<TypeCount>,
    pub combos: Vec<ComboCount>,
    pub reference_count: u32,
    pub reference_note: Option<&'static str>,
    pub hidden_notice: Option<&'static str>,
    /// 시험이 점수를 확인한다. 원문이 아니다.
    pub score: i32,
    pub immediate: bool,
}

impl ScanResult {
    pub fn failed(reason: ReasonCode) -> Self {
        Self {
            status: ExtractStatus::Failed,
            grade: Grade::Unavailable,
            partial_note: None,
            reason: Some(reason),
            types: Vec::new(),
            combos: Vec::new(),
            reference_count: 0,
            reference_note: None,
            hidden_notice: None,
            score: 0,
            immediate: false,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PreviewTarget {
    pub kind: FindingKind,
    pub location: Location,
}
