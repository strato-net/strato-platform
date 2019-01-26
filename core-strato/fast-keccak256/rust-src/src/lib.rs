extern crate sha3;
use sha3::Digest;

#[no_mangle]
pub extern fn fastKeccak256(src: *const u8, len: usize, dst: *mut u8) -> () {
    unsafe {
        let input = std::slice::from_raw_parts(src, len);
        let output = sha3::Keccak256::digest(&input);
        let output_ptr = output.as_ptr();
        std::ptr::copy(output_ptr, dst, 32)
    }
}
