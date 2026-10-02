pub fn local_name(name: &str) -> &str {
    name.rsplit(':').next().unwrap_or(name)
}

pub fn xml_text(raw: &str) -> String {
    raw.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

pub fn is_object_tag(name: &str) -> bool {
    matches!(
        name,
        "chart" | "ole" | "oleobject" | "pic" | "drawing" | "object" | "equation" | "img" | "shape"
    )
}
