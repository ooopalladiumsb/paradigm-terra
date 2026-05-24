//! Self-contained signed 256-bit integer for DSL int256 arithmetic.
//!
//! Representation is sign + magnitude: `neg` plus a little-endian `[u64; 4]`
//! magnitude (limb 0 least significant). The valid range is exactly
//! [-2^255, 2^255 - 1]; `None` from the checked operations signals an out-of-
//! range result (the DSL ERROR/OVERFLOW outcome). No external crate is used so
//! the crate keeps canonical-rs's no-build-script / no-proc-macro posture.

use std::cmp::Ordering;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct I256 {
    neg: bool,
    mag: [u64; 4],
}

/// 2^255 as a magnitude — the inclusive bound for negatives, exclusive for
/// positives.
const POW255: [u64; 4] = [0, 0, 0, 0x8000_0000_0000_0000];

fn u_is_zero(a: &[u64; 4]) -> bool {
    a == &[0, 0, 0, 0]
}

fn u_cmp(a: &[u64; 4], b: &[u64; 4]) -> Ordering {
    for i in (0..4).rev() {
        match a[i].cmp(&b[i]) {
            Ordering::Equal => continue,
            ord => return ord,
        }
    }
    Ordering::Equal
}

/// a + b over 256 bits; returns (sum, carry-out).
fn u_add(a: &[u64; 4], b: &[u64; 4]) -> ([u64; 4], bool) {
    let mut out = [0u64; 4];
    let mut carry = 0u128;
    for i in 0..4 {
        let s = a[i] as u128 + b[i] as u128 + carry;
        out[i] = s as u64;
        carry = s >> 64;
    }
    (out, carry != 0)
}

/// a - b, assuming a >= b.
fn u_sub(a: &[u64; 4], b: &[u64; 4]) -> [u64; 4] {
    let mut out = [0u64; 4];
    let mut borrow = 0i128;
    for i in 0..4 {
        let d = a[i] as i128 - b[i] as i128 - borrow;
        if d < 0 {
            out[i] = (d + (1i128 << 64)) as u64;
            borrow = 1;
        } else {
            out[i] = d as u64;
            borrow = 0;
        }
    }
    out
}

/// Full 256x256 -> 512-bit product.
fn u_mul(a: &[u64; 4], b: &[u64; 4]) -> [u64; 8] {
    let mut out = [0u64; 8];
    for i in 0..4 {
        let mut carry = 0u128;
        for j in 0..4 {
            let cur = out[i + j] as u128 + (a[i] as u128) * (b[j] as u128) + carry;
            out[i + j] = cur as u64;
            carry = cur >> 64;
        }
        out[i + 4] += carry as u64;
    }
    out
}

fn get_bit(a: &[u64; 4], i: usize) -> u64 {
    (a[i / 64] >> (i % 64)) & 1
}

fn shl1(a: &[u64; 4]) -> [u64; 4] {
    let mut out = [0u64; 4];
    let mut carry = 0u64;
    for i in 0..4 {
        out[i] = (a[i] << 1) | carry;
        carry = a[i] >> 63;
    }
    out
}

/// Unsigned truncated divmod via binary long division.
fn u_divmod(a: &[u64; 4], b: &[u64; 4]) -> ([u64; 4], [u64; 4]) {
    let mut q = [0u64; 4];
    let mut r = [0u64; 4];
    for i in (0..256).rev() {
        r = shl1(&r);
        r[0] |= get_bit(a, i);
        if u_cmp(&r, b) != Ordering::Less {
            r = u_sub(&r, b);
            q[i / 64] |= 1u64 << (i % 64);
        }
    }
    (q, r)
}

fn in_range(neg: bool, mag: &[u64; 4]) -> bool {
    match u_cmp(mag, &POW255) {
        Ordering::Less => true,            // |x| < 2^255 always valid
        Ordering::Equal => neg,            // exactly 2^255 valid only as -2^255
        Ordering::Greater => false,
    }
}

fn make(neg: bool, mag: [u64; 4]) -> Option<I256> {
    if !in_range(neg, &mag) {
        return None;
    }
    Some(I256 { neg: neg && !u_is_zero(&mag), mag })
}

/// Core add of two sign+magnitude operands, range-checked.
fn add_raw(neg_a: bool, mag_a: &[u64; 4], neg_b: bool, mag_b: &[u64; 4]) -> Option<I256> {
    if neg_a == neg_b {
        let (sum, carry) = u_add(mag_a, mag_b);
        if carry {
            return None;
        }
        make(neg_a, sum)
    } else {
        match u_cmp(mag_a, mag_b) {
            Ordering::Equal => Some(I256 { neg: false, mag: [0, 0, 0, 0] }),
            Ordering::Greater => make(neg_a, u_sub(mag_a, mag_b)),
            Ordering::Less => make(neg_b, u_sub(mag_b, mag_a)),
        }
    }
}

impl I256 {
    pub fn from_u64(n: u64) -> I256 {
        I256 { neg: false, mag: [n, 0, 0, 0] }
    }

    pub fn is_zero(&self) -> bool {
        u_is_zero(&self.mag)
    }

    pub fn is_negative(&self) -> bool {
        self.neg
    }

    /// Parse a canonical decimal integer (optional leading '-'); `None` if
    /// malformed or out of the int256 range.
    pub fn from_dec_str(s: &str) -> Option<I256> {
        let (neg, digits) = match s.strip_prefix('-') {
            Some(rest) => (true, rest),
            None => (false, s),
        };
        if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        let mut mag = [0u64; 4];
        let ten = [10u64, 0, 0, 0];
        for d in digits.bytes() {
            let prod = u_mul(&mag, &ten);
            if prod[4] | prod[5] | prod[6] | prod[7] != 0 {
                return None; // exceeded 256 bits
            }
            mag = [prod[0], prod[1], prod[2], prod[3]];
            let (sum, carry) = u_add(&mag, &[(d - b'0') as u64, 0, 0, 0]);
            if carry {
                return None;
            }
            mag = sum;
        }
        make(neg, mag)
    }

    pub fn add(&self, o: &I256) -> Option<I256> {
        add_raw(self.neg, &self.mag, o.neg, &o.mag)
    }

    pub fn sub(&self, o: &I256) -> Option<I256> {
        let neg_b = if u_is_zero(&o.mag) { false } else { !o.neg };
        add_raw(self.neg, &self.mag, neg_b, &o.mag)
    }

    pub fn mul(&self, o: &I256) -> Option<I256> {
        let prod = u_mul(&self.mag, &o.mag);
        if prod[4] | prod[5] | prod[6] | prod[7] != 0 {
            return None;
        }
        make(self.neg ^ o.neg, [prod[0], prod[1], prod[2], prod[3]])
    }

    /// Truncated division (toward zero); `None` only for MIN / -1 (overflow).
    /// Caller must reject a zero divisor first.
    pub fn div(&self, o: &I256) -> Option<I256> {
        let (q, _) = u_divmod(&self.mag, &o.mag);
        make(self.neg ^ o.neg, q)
    }

    /// Non-negative Euclidean remainder. Caller must reject a zero divisor.
    pub fn euclid_mod(&self, o: &I256) -> I256 {
        let (_, r) = u_divmod(&self.mag, &o.mag);
        // truncated remainder takes the dividend's sign
        let trunc_neg = self.neg && !u_is_zero(&r);
        if trunc_neg {
            // r_euclid = trunc_rem + |divisor|  (always representable, in [0,|b|))
            add_raw(true, &r, false, &o.mag).expect("euclidean remainder in range")
        } else {
            I256 { neg: false, mag: r }
        }
    }
}

impl PartialOrd for I256 {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for I256 {
    fn cmp(&self, other: &Self) -> Ordering {
        match (self.neg, other.neg) {
            (false, true) => Ordering::Greater,
            (true, false) => Ordering::Less,
            (false, false) => u_cmp(&self.mag, &other.mag),
            (true, true) => u_cmp(&other.mag, &self.mag),
        }
    }
}
