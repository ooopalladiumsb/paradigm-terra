//! Minimal unsigned 256-bit integer for gas-unit / nano-PTRA arithmetic.
//!
//! Stored as little-endian `[u64; 4]`. Decimal parse/format produce canonical
//! decimal (no leading zeros; "0" for zero) so the round-trip through JCS
//! integers is byte-identical to the TS reference, which uses native `bigint`.
//! No external crate (keeps the crate build-script / proc-macro free for
//! musl-static). This is the reducer's `u256` plus a checked multiply, which the
//! gas layer needs for `units × price`, `bytes × rent`, and `fee × multiplier`.

use std::cmp::Ordering;
use std::ops::{Add, Mul};

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

    pub fn from_u64(n: u64) -> U256 {
        U256([n, 0, 0, 0])
    }

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

    /// a × b, `None` on overflow past 2^256-1 (schoolbook, 4×4 → 8 limbs).
    pub fn checked_mul(&self, o: &U256) -> Option<U256> {
        let mut res = [0u64; 8];
        for i in 0..4 {
            let mut carry: u128 = 0;
            for j in 0..4 {
                let idx = i + j;
                let cur = res[idx] as u128 + (self.0[i] as u128) * (o.0[j] as u128) + carry;
                res[idx] = cur as u64;
                carry = cur >> 64;
            }
            let mut idx = i + 4;
            while carry != 0 {
                if idx >= 8 {
                    return None;
                }
                let cur = res[idx] as u128 + carry;
                res[idx] = cur as u64;
                carry = cur >> 64;
                idx += 1;
            }
        }
        if res[4..8].iter().any(|&x| x != 0) {
            return None;
        }
        Some(U256([res[0], res[1], res[2], res[3]]))
    }

    /// Clamped subtraction: `a - b` if `a >= b`, else `0` (mirrors TS `clampSub`).
    pub fn saturating_sub(&self, o: &U256) -> U256 {
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
            U256::ZERO
        } else {
            U256(out)
        }
    }
}

// Gas amounts are bounded uint256; overflow here is a bug, not an expected
// outcome (the TS reference uses unbounded bigint and never overflows for valid
// inputs), so the operators panic rather than silently wrap.
impl Add for U256 {
    type Output = U256;
    fn add(self, o: U256) -> U256 {
        self.checked_add(&o).expect("U256 add overflow")
    }
}
impl Mul for U256 {
    type Output = U256;
    fn mul(self, o: U256) -> U256 {
        self.checked_mul(&o).expect("U256 mul overflow")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_arith() {
        assert_eq!(U256::from_u64(0).to_dec_str(), "0");
        assert_eq!(U256::from_dec_str("1000000000000000000").unwrap().to_dec_str(), "1000000000000000000");
        let a = U256::from_u64(669);
        let b = U256::from_u64(1000);
        assert_eq!((a * b).to_dec_str(), "669000");
        assert_eq!((U256::from_u64(100_000) + U256::from_u64(324_000)).to_dec_str(), "424000");
        assert_eq!(U256::from_u64(5).saturating_sub(&U256::from_u64(9)).to_dec_str(), "0");
        assert_eq!(U256::from_u64(10_000_000).saturating_sub(&U256::from_u64(324_000)).to_dec_str(), "9676000");
        assert!(U256::from_u64(50) < U256::from_u64(10_100_000));
    }
}
