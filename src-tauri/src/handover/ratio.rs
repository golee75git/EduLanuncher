//! 이름 유사도. 같은 글자 덩어리를 찾아 길이를 더하고, 두 문자열 길이로 나눈다.

use std::collections::HashMap;

pub fn match_ratio(left: &str, right: &str) -> f64 {
    let a: Vec<char> = left.chars().collect();
    let b: Vec<char> = right.chars().collect();
    let matched = matching_chars(&a, &b);
    if a.len() + b.len() == 0 {
        1.0
    } else {
        2.0 * matched as f64 / (a.len() + b.len()) as f64
    }
}

fn matching_chars(a: &[char], b: &[char]) -> usize {
    let places = build_places(b);
    let mut blocks = Vec::new();
    let mut queue = vec![(0usize, a.len(), 0usize, b.len())];
    while let Some((alo, ahi, blo, bhi)) = queue.pop() {
        let (start_a, start_b, size) = find_longest(&places, a, alo, ahi, blo, bhi);
        if size == 0 {
            continue;
        }
        blocks.push((start_a, start_b, size));
        if alo < start_a && blo < start_b {
            queue.push((alo, start_a, blo, start_b));
        }
        if start_a + size < ahi && start_b + size < bhi {
            queue.push((start_a + size, ahi, start_b + size, bhi));
        }
    }
    blocks.sort_by_key(|(start_a, start_b, _)| (*start_a, *start_b));
    let mut total = 0usize;
    let mut prev_a = 0usize;
    let mut prev_b = 0usize;
    let mut prev_size = 0usize;
    let mut have = false;
    for (start_a, start_b, size) in blocks {
        if have && prev_a + prev_size == start_a && prev_b + prev_size == start_b {
            prev_size += size;
            continue;
        }
        if have {
            total += prev_size;
        }
        prev_a = start_a;
        prev_b = start_b;
        prev_size = size;
        have = true;
    }
    if have {
        total += prev_size;
    }
    total
}

fn build_places(text: &[char]) -> HashMap<char, Vec<usize>> {
    let mut counts = HashMap::<char, usize>::new();
    for ch in text {
        *counts.entry(*ch).or_insert(0) += 1;
    }
    let junk_at = if text.len() >= 200 { 1 + text.len() / 100 } else { usize::MAX };
    let mut places = HashMap::<char, Vec<usize>>::new();
    for (pos, ch) in text.iter().enumerate() {
        if counts.get(ch).copied().unwrap_or(0) > junk_at {
            continue;
        }
        places.entry(*ch).or_default().push(pos);
    }
    places
}

fn find_longest(
    places: &HashMap<char, Vec<usize>>,
    a: &[char],
    alo: usize,
    ahi: usize,
    blo: usize,
    bhi: usize,
) -> (usize, usize, usize) {
    let mut best_a = alo;
    let mut best_b = blo;
    let mut best = 0usize;
    let mut prev: HashMap<usize, usize> = HashMap::new();
    for i in alo..ahi {
        let mut next: HashMap<usize, usize> = HashMap::new();
        if let Some(spots) = places.get(&a[i]) {
            for &j in spots {
                if j < blo {
                    continue;
                }
                if j >= bhi {
                    break;
                }
                let earlier = if j == 0 { 0 } else { prev.get(&(j - 1)).copied().unwrap_or(0) };
                let size = earlier + 1;
                next.insert(j, size);
                if size > best {
                    best_a = i + 1 - size;
                    best_b = j + 1 - size;
                    best = size;
                }
            }
        }
        prev = next;
    }
    (best_a, best_b, best)
}
