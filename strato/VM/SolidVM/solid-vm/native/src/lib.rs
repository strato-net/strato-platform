use ark_bn254::{Bn254, Fq, Fq2, Fr, G1Affine, G1Projective, G2Affine};
use ark_ec::{pairing::Pairing, AffineRepr, CurveGroup};
use ark_ff::{One, PrimeField, Zero};
use ark_serialize::{CanonicalDeserialize, CanonicalSerialize};
use std::{cell::RefCell, ptr, slice};

const FQ_LEN: usize = 32;
const G1_LEN: usize = 64;
const G2_LEN: usize = 128;
const PAIR_LEN: usize = G1_LEN + G2_LEN;
const G2_CACHE_SLOTS: usize = 64;

type G2Prepared = <Bn254 as Pairing>::G2Prepared;
type CachedG2 = ([u8; G2_LEN], G2Prepared);

thread_local! {
    // A bounded per-capability cache avoids global contention in the threaded
    // Haskell runtime. A full input comparison makes collisions affect only
    // performance, never point identity or validation semantics.
    static G2_CACHE: RefCell<Vec<Option<CachedG2>>> =
        RefCell::new((0..G2_CACHE_SLOTS).map(|_| None).collect());
}

#[inline]
fn read_fq(input_be: &[u8]) -> Result<Fq, ()> {
    let mut input_le = [0_u8; FQ_LEN];
    input_le.copy_from_slice(input_be);
    input_le.reverse();
    Fq::deserialize_uncompressed(&input_le[..]).map_err(|_| ())
}

#[inline]
fn read_fq2(input: &[u8]) -> Result<Fq2, ()> {
    let imaginary = read_fq(&input[..FQ_LEN])?;
    let real = read_fq(&input[FQ_LEN..2 * FQ_LEN])?;
    Ok(Fq2::new(real, imaginary))
}

#[inline]
fn read_g1(input: &[u8]) -> Result<G1Affine, ()> {
    let x = read_fq(&input[..FQ_LEN])?;
    let y = read_fq(&input[FQ_LEN..G1_LEN])?;
    if x.is_zero() && y.is_zero() {
        return Ok(G1Affine::zero());
    }
    let point = G1Affine::new_unchecked(x, y);
    if point.is_on_curve() && point.is_in_correct_subgroup_assuming_on_curve() {
        Ok(point)
    } else {
        Err(())
    }
}

#[inline]
fn encode_g1(point: G1Affine) -> [u8; G1_LEN] {
    let mut output = [0_u8; G1_LEN];
    let Some((x, y)) = point.xy() else {
        return output;
    };
    x.serialize_uncompressed(&mut output[..FQ_LEN])
        .expect("fixed-size Fq output");
    y.serialize_uncompressed(&mut output[FQ_LEN..])
        .expect("fixed-size Fq output");
    output[..FQ_LEN].reverse();
    output[FQ_LEN..].reverse();
    output
}

#[inline]
fn read_g2(input: &[u8]) -> Result<G2Affine, ()> {
    let x = read_fq2(&input[..2 * FQ_LEN])?;
    let y = read_fq2(&input[2 * FQ_LEN..G2_LEN])?;
    if x.is_zero() && y.is_zero() {
        return Ok(G2Affine::zero());
    }
    let point = G2Affine::new_unchecked(x, y);
    if point.is_on_curve() && point.is_in_correct_subgroup_assuming_on_curve() {
        Ok(point)
    } else {
        Err(())
    }
}

#[inline]
fn g2_cache_index(input: &[u8; G2_LEN]) -> usize {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in input {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash as usize % G2_CACHE_SLOTS
}

#[inline]
fn read_g2_cached(input: &[u8]) -> Result<G2Prepared, ()> {
    let key: [u8; G2_LEN] = input.try_into().map_err(|_| ())?;
    let slot = g2_cache_index(&key);
    if let Some(point) = G2_CACHE.with(|cache| {
        cache.borrow()[slot]
            .as_ref()
            .filter(|(cached_key, _)| cached_key == &key)
            .map(|(_, point)| point.clone())
    }) {
        return Ok(point);
    }
    let prepared = G2Prepared::from(read_g2(&key)?);
    G2_CACHE.with(|cache| cache.borrow_mut()[slot] = Some((key, prepared.clone())));
    Ok(prepared)
}

fn pairing_check(input: &[u8]) -> Result<bool, ()> {
    if input.len() % PAIR_LEN != 0 {
        return Err(());
    }
    let mut g1_points = Vec::with_capacity(input.len() / PAIR_LEN);
    let mut g2_points = Vec::with_capacity(input.len() / PAIR_LEN);
    for pair in input.chunks_exact(PAIR_LEN) {
        let g1 = read_g1(&pair[..G1_LEN])?;
        let g2 = read_g2_cached(&pair[G1_LEN..])?;
        g1_points.push(g1);
        g2_points.push(g2);
    }
    if g1_points.is_empty() {
        return Ok(true);
    }
    Ok(Bn254::multi_pairing(&g1_points, g2_points).0.is_one())
}

/// Evaluate an EIP-197 BN254 pairing input.
///
/// Returns 1 for the multiplicative identity, 0 for a valid non-identity
/// product, and -1 for malformed points or input. `input` may be null only
/// when `len` is zero.
#[no_mangle]
pub unsafe extern "C" fn solidvm_bn254_pairing(input: *const u8, len: usize) -> i32 {
    if input.is_null() && len != 0 {
        return -1;
    }
    let bytes = if len == 0 {
        &[]
    } else {
        // SAFETY: the caller owns a readable buffer of exactly `len` bytes for
        // the duration of this synchronous call.
        unsafe { slice::from_raw_parts(input, len) }
    };
    match pairing_check(bytes) {
        Ok(result) => i32::from(result),
        Err(_) => -1,
    }
}

/// Add two EIP-196 G1 points encoded as x1 || y1 || x2 || y2.
#[no_mangle]
pub unsafe extern "C" fn solidvm_bn254_g1_add(
    input: *const u8,
    len: usize,
    output: *mut u8,
) -> i32 {
    if input.is_null() || output.is_null() || len != 2 * G1_LEN {
        return -1;
    }
    let bytes = unsafe { slice::from_raw_parts(input, len) };
    let Ok(first) = read_g1(&bytes[..G1_LEN]) else {
        return -1;
    };
    let Ok(second) = read_g1(&bytes[G1_LEN..]) else {
        return -1;
    };
    let sum: G1Projective = first.into_group() + second;
    let encoded = encode_g1(sum.into_affine());
    unsafe { ptr::copy_nonoverlapping(encoded.as_ptr(), output, G1_LEN) };
    0
}

/// Multiply one EIP-196 G1 point by a 32-byte big-endian scalar.
#[no_mangle]
pub unsafe extern "C" fn solidvm_bn254_g1_mul(
    input: *const u8,
    len: usize,
    output: *mut u8,
) -> i32 {
    if input.is_null() || output.is_null() || len != G1_LEN + FQ_LEN {
        return -1;
    }
    let bytes = unsafe { slice::from_raw_parts(input, len) };
    let Ok(point) = read_g1(&bytes[..G1_LEN]) else {
        return -1;
    };
    let scalar = Fr::from_be_bytes_mod_order(&bytes[G1_LEN..]);
    let product = point.mul_bigint(scalar.into_bigint()).into_affine();
    let encoded = encode_g1(product);
    unsafe { ptr::copy_nonoverlapping(encoded.as_ptr(), output, G1_LEN) };
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encode_u64(value: u64) -> [u8; 32] {
        let mut bytes = [0_u8; 32];
        bytes[24..].copy_from_slice(&value.to_be_bytes());
        bytes
    }

    fn decode_hex(input: &str) -> Vec<u8> {
        let compact: Vec<_> = input
            .bytes()
            .filter(|byte| !byte.is_ascii_whitespace())
            .collect();
        assert_eq!(compact.len() % 2, 0);
        compact
            .chunks_exact(2)
            .map(|pair| {
                let digit = |byte: u8| match byte {
                    b'0'..=b'9' => byte - b'0',
                    b'a'..=b'f' => byte - b'a' + 10,
                    b'A'..=b'F' => byte - b'A' + 10,
                    _ => panic!("invalid hex"),
                };
                digit(pair[0]) * 16 + digit(pair[1])
            })
            .collect()
    }

    #[test]
    fn matches_revm_two_pair_vector() {
        let input = decode_hex(
            "1c76476f4def4bb94541d57ebba1193381ffa7aa76ada664dd31c16024c43f59
             3034dd2920f673e204fee2811c678745fc819b55d3e9d294e45c9b03a76aef41
             209dd15ebff5d46c4bd888e51a93cf99a7329636c63514396b4a452003a35bf7
             04bf11ca01483bfa8b34b43561848d28905960114c8ac04049af4b6315a41678
             2bb8324af6cfc93537a2ad1a445cfd0ca2a71acd7ac41fadbf933c2a51be344d
             120a2a4cf30c1bf9845f20c6fe39e07ea2cce61f0c9bb048165fe5e4de877550
             111e129f1cf1097710d41c4ac70fcdfa5ba2023c6ff1cbeac322de49d1b6df7c
             2032c61a830e3c17286de9462bf242fca2883585b93870a73853face6a6bf411
             198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c2
             1800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed
             090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b
             12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa",
        );
        assert_eq!(
            unsafe { solidvm_bn254_pairing(input.as_ptr(), input.len()) },
            1
        );

        let iterations = 200_u32;
        let started = std::time::Instant::now();
        for _ in 0..iterations {
            assert_eq!(
                unsafe { solidvm_bn254_pairing(input.as_ptr(), input.len()) },
                1
            );
        }
        let nanos_per_pairing = started.elapsed().as_nanos() / u128::from(iterations);
        eprintln!("native BN254 two-pair check: {nanos_per_pairing} ns/op");
    }

    #[test]
    fn accepts_empty_product_and_rejects_bad_length() {
        assert_eq!(unsafe { solidvm_bn254_pairing(std::ptr::null(), 0) }, 1);
        let invalid = [0_u8; 1];
        assert_eq!(
            unsafe { solidvm_bn254_pairing(invalid.as_ptr(), invalid.len()) },
            -1
        );
    }

    #[test]
    fn g1_add_and_mul_double_the_generator() {
        let mut add_input = [0_u8; 128];
        add_input[..32].copy_from_slice(&encode_u64(1));
        add_input[32..64].copy_from_slice(&encode_u64(2));
        add_input[64..96].copy_from_slice(&encode_u64(1));
        add_input[96..].copy_from_slice(&encode_u64(2));
        let mut add_output = [0_u8; 64];
        assert_eq!(
            unsafe {
                solidvm_bn254_g1_add(add_input.as_ptr(), add_input.len(), add_output.as_mut_ptr())
            },
            0
        );

        let mut mul_input = [0_u8; 96];
        mul_input[..64].copy_from_slice(&add_input[..64]);
        mul_input[64..].copy_from_slice(&encode_u64(2));
        let mut mul_output = [0_u8; 64];
        assert_eq!(
            unsafe {
                solidvm_bn254_g1_mul(mul_input.as_ptr(), mul_input.len(), mul_output.as_mut_ptr())
            },
            0
        );
        assert_eq!(add_output, mul_output);
        assert_ne!(add_output, [0_u8; 64]);
    }
}
