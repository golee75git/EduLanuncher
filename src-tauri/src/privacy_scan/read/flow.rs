use quick_xml::events::Event;
use quick_xml::Reader;

use crate::privacy_scan::model::{Field, Location, Record, Role};
use crate::privacy_scan::read::xmlutil::{self, local_name};

pub struct FlowOut {
    pub records: Vec<Record>,
    pub saw_object: bool,
}

pub fn read_flow(xml: &str, role: Role, hidden: bool, table_base: u32) -> Option<FlowOut> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    let mut records = Vec::new();
    let mut saw_object = false;
    let mut table_id = table_base;
    let mut in_table = 0u32;
    let mut row_index = 0u32;
    let mut cell_index = 0u32;
    let mut para_index = 0u32;
    let mut in_row = false;
    let mut in_cell = false;
    let mut in_para = false;
    let mut row_cells: Vec<Field> = Vec::new();
    let mut cell_text = String::new();
    let mut para_text = String::new();

    loop {
        if super::halted() {
            return None;
        }
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(element)) => {
                let name = local_name(element.name().as_ref()).to_string();
                if xmlutil::is_object_tag(&name) {
                    saw_object = true;
                }
                match name.as_str() {
                    "tbl" => {
                        in_table += 1;
                        if in_table == 1 {
                            table_id = table_id.saturating_add(1);
                            row_index = 0;
                        }
                    }
                    "tr" if in_table > 0 => {
                        in_row = true;
                        row_index = row_index.saturating_add(1);
                        cell_index = 0;
                        row_cells.clear();
                    }
                    "tc" if in_row => {
                        in_cell = true;
                        cell_index = cell_index.saturating_add(1);
                        cell_text.clear();
                    }
                    "p" => {
                        in_para = true;
                        if !in_cell {
                            para_text.clear();
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(element)) => {
                let name = local_name(element.name().as_ref()).to_string();
                if xmlutil::is_object_tag(&name) {
                    saw_object = true;
                }
            }
            Ok(Event::Text(text)) => {
                let piece = xmlutil::xml_text(text.as_ref());
                if in_cell {
                    cell_text.push_str(&piece);
                } else if in_para {
                    para_text.push_str(&piece);
                }
            }
            Ok(Event::End(element)) => {
                let name = local_name(element.name().as_ref()).to_string();
                match name.as_str() {
                    "tc" if in_cell => {
                        row_cells.push(Field {
                            header: None,
                            text: cell_text.trim().to_string(),
                            location: Location::TableCell { table: table_id, row: row_index, col: cell_index },
                            hidden,
                        });
                        cell_text.clear();
                        in_cell = false;
                    }
                    "tr" if in_row => {
                        if row_cells.iter().any(|cell| !cell.text.is_empty()) {
                            records.push(Record {
                                location: Location::TableCell { table: table_id, row: row_index, col: 1 },
                                role,
                                hidden,
                                cells: std::mem::take(&mut row_cells),
                            });
                        }
                        in_row = false;
                    }
                    "tbl" => {
                        in_table = in_table.saturating_sub(1);
                    }
                    "p" => {
                        if !in_cell {
                            let text = para_text.trim().to_string();
                            if !text.is_empty() {
                                para_index = para_index.saturating_add(1);
                                records.push(Record {
                                    location: Location::Paragraph { index: para_index },
                                    role,
                                    hidden,
                                    cells: vec![Field {
                                        header: None,
                                        text,
                                        location: Location::Paragraph { index: para_index },
                                        hidden,
                                    }],
                                });
                            }
                            para_text.clear();
                        }
                        in_para = false;
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => return None,
            _ => {}
        }
        buf.clear();
    }
    Some(FlowOut { records, saw_object })
}
