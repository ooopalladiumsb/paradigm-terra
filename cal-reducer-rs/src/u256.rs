//! Minimal unsigned 256-bit integer for reducer balance/fee arithmetic.
//!
//! Stored as little-endian `[u64; 4]`. Decimal parse/format produce canonical
//! decimal (no leading zeros; "0" for zero) so the round-trip through JcsValue
//! integers is byte-identical to the TS reference. No external crate (keeps the
//! crate build-script / proc-macro free for musl-static).

use std::cmp::Ordering;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct U256(pub [u64; 4]);

impl PartialOrd for U256 {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}
impl Ord for U256 {
    fn cmp(&self, o: &Self) -> Ordering {
        for i in (0..4).rev() {
            match self.0[i].cmp(&o.0[i]) {
                Ordering::Equal => continue,
                x => return x,
            }
        }
        Ordering::Equal
    }
}

impl U256 {
    pub const ZERO: U256 = U256([0, 0, 0, 0]);

    pub fn is_zero(&self) -> bool {
        self.0 == [0, 0, 0, 0]
    }

    /// Parse a non-negative canonical decimal string; `None` if malformed or > 2^256-1.
    pub fn from_dec_str(s: &str) -> Option<U256> {
        if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        let mut mag = [0u64; 4];
        for d in s.bytes() {
            // mag = mag * 10 + digit, detecting overflow past 256 bits.
            let mut carry = 0u128;
            for limb in mag.iter_mut() {
                let cur = (*limb as u128) * 10 + carry;
                *limb = cur as u64;
                carry = cur >> 64;
            }
            if carry != 0 {
                return None;
            }
            let mut add = (d - b'0') as u128;
            for limb in mag.iter_mut() {
                let cur = *limb as u128 + add;
                *limb = cur as u64;
                add = cur >> 64;
            }
            if add != 0 {
                return None;
            }
        }
        Some(U256(mag))
    }

    /// Canonical decimal string.
    pub fn to_dec_str(&self) -> String {
        if self.is_zero() {
            return "0".to_string();
        }
        let mut limbs = self.0;
        let mut digits = Vec::new();
        while limbs != [0, 0, 0, 0] {
            // divmod by 10, high limb first
            let mut rem = 0u128;
            for i in (0..4).rev() {
                let cur = (rem << 64) | limbs[i] as u128;
                limbs[i] = (cur / 10) as u64;
                rem = cur % 10;
            }
            digits.push(b'0' + rem as u8);
        }
        digits.reverse();
        String::from_utf8(digits).unwrap()
    }

    /// a + b, `None` on overflow past 2^256-1.
    pub fn checked_add(&self, o: &U256) -> Option<U256> {
        let mut out = [0u64; 4];
        let mut carry = 0u128;
        for i in 0..4 {
            let s = self.0[i] as u128 + o.0[i] as u128 + carry;
            out[i] = s as u64;
            carry = s >> 64;
        }
        if carry != 0 {
            None
        } else {
            Some(U256(out))
        }
    }

    /// a - b, `None` on underflow (a < b).
    pub fn checked_sub(&self, o: &U256) -> Option<U256> {
        let mut out = [0u64; 4];
        let mut borrow = 0i128;
        for i in 0..4 {
            let d = self.0[i] as i128 - o.0[i] as i128 - borrow;
            if d < 0 {
                out[i] = (d + (1i128 << 64)) as u64;
                borrow = 1;
            } else {
                out[i] = d as u64;
                borrow = 0;
            }
        }
        if borrow != 0 {
            None
        } else {
            Some(U256(out))
        }
    }
}
