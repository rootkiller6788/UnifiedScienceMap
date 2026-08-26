#![no_std]

const MAX_NODES: usize = 200_000;
const MAX_OUTPUT: usize = 60_000;
const MAX_DIRS: usize = 64;

#[no_mangle]
static mut XS: [f32; MAX_NODES] = [0.0; MAX_NODES];
#[no_mangle]
static mut YS: [f32; MAX_NODES] = [0.0; MAX_NODES];
#[no_mangle]
static mut DIRS: [u16; MAX_NODES] = [0; MAX_NODES];
#[no_mangle]
static mut DEGREES: [i32; MAX_NODES] = [0; MAX_NODES];
#[no_mangle]
static mut HIDDEN: [u8; MAX_DIRS] = [0; MAX_DIRS];
#[no_mangle]
static mut OUTPUT: [u32; MAX_OUTPUT] = [0; MAX_OUTPUT];

#[no_mangle]
pub extern "C" fn xs_ptr() -> *mut f32 {
    core::ptr::addr_of_mut!(XS).cast::<f32>()
}

#[no_mangle]
pub extern "C" fn ys_ptr() -> *mut f32 {
    core::ptr::addr_of_mut!(YS).cast::<f32>()
}

#[no_mangle]
pub extern "C" fn dirs_ptr() -> *mut u16 {
    core::ptr::addr_of_mut!(DIRS).cast::<u16>()
}

#[no_mangle]
pub extern "C" fn degrees_ptr() -> *mut i32 {
    core::ptr::addr_of_mut!(DEGREES).cast::<i32>()
}

#[no_mangle]
pub extern "C" fn hidden_ptr() -> *mut u8 {
    core::ptr::addr_of_mut!(HIDDEN).cast::<u8>()
}

#[no_mangle]
pub extern "C" fn output_ptr() -> *mut u32 {
    core::ptr::addr_of_mut!(OUTPUT).cast::<u32>()
}

#[no_mangle]
pub extern "C" fn max_nodes() -> u32 {
    MAX_NODES as u32
}

#[no_mangle]
pub extern "C" fn max_output() -> u32 {
    MAX_OUTPUT as u32
}

#[no_mangle]
pub extern "C" fn filter_visible(
    count: u32,
    left: f32,
    right: f32,
    top: f32,
    bottom: f32,
    cap: u32,
) -> u32 {
    let n = min_u32(count, MAX_NODES as u32);
    let limit = min_u32(cap, MAX_OUTPUT as u32);
    let mut written = 0u32;
    let mut i = 0u32;
    let mut visible = 0u32;

    unsafe {
        while i < n {
            let idx = i as usize;
            let dir = DIRS[idx] as usize;
            if dir < MAX_DIRS
                && HIDDEN[dir] == 0
                && XS[idx] >= left
                && XS[idx] <= right
                && YS[idx] >= top
                && YS[idx] <= bottom
            {
                visible += 1;
            }
            i += 1;
        }

        let stride = if visible > limit && limit > 0 {
            visible / limit + 1
        } else {
            1
        };
        let mut seen = 0u32;
        i = 0;
        while i < n && written < limit {
            let idx = i as usize;
            let dir = DIRS[idx] as usize;
            if dir < MAX_DIRS
                && HIDDEN[dir] == 0
                && XS[idx] >= left
                && XS[idx] <= right
                && YS[idx] >= top
                && YS[idx] <= bottom
            {
                if seen % stride == 0 {
                    OUTPUT[written as usize] = i;
                    written += 1;
                }
                seen += 1;
            }
            i += 1;
        }
    }

    written
}

const fn min_u32(a: u32, b: u32) -> u32 {
    if a < b { a } else { b }
}

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    loop {}
}
