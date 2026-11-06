"""Build a minimal PhotoCraft plug-in (ABI v1) by hand, no toolchain required.

Exports: memory, pc_abi_version() -> i32, pc_manifest() -> i64,
         pc_alloc(i32) -> i32, pc_filter(8 x i32) -> i32
No imports (the host rejects any).
"""
import struct

# ---------------------------------------------------------------- LEB128
def uleb(n):
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def sleb(n):
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if (n == 0 and not (b & 0x40)) or (n == -1 and (b & 0x40)):
            out.append(b)
            return bytes(out)
        out.append(b | 0x80)


def section(sid, payload):
    return bytes([sid]) + uleb(len(payload)) + payload


MANIFEST = (
    '{"id":"com.example.pc.demo.invert","name":"Invert (WASM demo)","version":"1.0.0",'
    '"kind":"filter","author":"demo","description":"Inverts colour channels; verifies the plug-in ABI v1.",'
    '"params":{}}'
).encode()
DATA_OFF = 1024

I32, I64 = 0x7F, 0x7E

# ---------------------------------------------------------------- types
t0 = bytes([0x60]) + uleb(0) + uleb(1) + bytes([I32])          # () -> i32
t1 = bytes([0x60]) + uleb(0) + uleb(1) + bytes([I64])          # () -> i64
t2 = bytes([0x60]) + uleb(1) + bytes([I32]) + uleb(1) + bytes([I32])   # (i32) -> i32
t3 = bytes([0x60]) + uleb(8) + bytes([I32]) * 8 + uleb(1) + bytes([I32])
type_sec = section(1, uleb(4) + t0 + t1 + t2 + t3)

func_sec = section(3, uleb(4) + bytes([0, 1, 2, 3]))

memory_sec = section(5, uleb(1) + bytes([0x00]) + uleb(1))

# ---------------------------------------------------------------- exports
def export(name, kind, idx):
    b = name.encode()
    return uleb(len(b)) + b + bytes([kind]) + uleb(idx)


exports = b""
for nm, kind, idx in [
    ("memory", 0x02, 0),
    ("pc_abi_version", 0x00, 0),
    ("pc_manifest", 0x00, 1),
    ("pc_alloc", 0x00, 2),
    ("pc_filter", 0x00, 3),
]:
    exports += export(nm, kind, idx)
export_sec = section(7, uleb(5) + exports)

# ---------------------------------------------------------------- code
def body(locals_, code):
    inner = locals_ + code + b"\x0b"
    return uleb(len(inner)) + inner


# () -> i32 : return 1
b_abi = body(uleb(0), b"\x41\x01")

# () -> i64 : return (len << 32) | DATA_OFF
b_manifest = body(uleb(0), b"\x42" + sleb((len(MANIFEST) << 32) | DATA_OFF))

# (size) -> ptr : memory.grow(ceil(size/65536))
b_alloc = body(
    uleb(1) + uleb(1) + bytes([I32]),           # one i32 local (idx 1)
    b"\x20\x00"                                  # local.get 0
    b"\x41" + sleb(65535) + b"\x6a"              # + 65535
    b"\x41" + sleb(65536) + b"\x6e"              # / 65536  (div_u)
    b"\x40\x00"                                  # memory.grow
    b"\x22\x01"                                  # local.tee 1
    b"\x41\x7f"                                  # i32.const -1
    b"\x46"                                      # i32.eq
    b"\x04\x7f"                                  # if (result i32)
    b"\x41\x00"                                  #   i32.const 0
    b"\x05"                                      # else
    b"\x20\x01"                                  #   local.get 1
    b"\x41" + sleb(65536) + b"\x6c"              #   * 65536
    b"\x0b",                                     # end
)

# (buf, len, w, h, channels, format, params, params_len) -> i32
# locals 8..11 = n, colour, i, j
code = bytearray()
code += b"\x20\x04\x21\x08"                      # n = channels
code += b"\x20\x08\x45\x04\x40"                  # if n == 0 {
code += b"\x41\x01\x0f"                          #   return 1
code += b"\x0b"
code += b"\x20\x08\x21\x09"                      # colour = n
code += b"\x20\x05\x41" + sleb(256) + b"\x71\x41\x00\x47"   # (format & 256) != 0
code += b"\x04\x40"                              # if {
code += b"\x20\x08\x41\x01\x6b\x21\x09"          #   colour = n - 1
code += b"\x0b"
code += b"\x41\x00\x21\x0a"                      # i = 0
code += b"\x02\x40"                              # block {
code += b"\x03\x40"                              #   loop {
code += b"\x20\x0a\x20\x01\x41\x02\x76\x4f"      #     i >= len/4 ?
code += b"\x0d\x01"                              #     br_if 1
# skip = alpha_present && buf[i + n - 1] <= 0
code += b"\x20\x05\x41" + sleb(256) + b"\x71\x41\x00\x47"   # alpha present
code += b"\x20\x00"                              # buf
code += b"\x20\x0a\x20\x08\x41\x01\x6b\x6a"      # + (i + n - 1)
code += b"\x41\x04\x6c\x6a"                      # * 4
code += b"\x2a\x02\x00"                          # f32.load
code += b"\x43\x00\x00\x00\x00"                  # f32.const 0
code += b"\x5f"                                  # f32.le
code += b"\x71"                                  # i32.and
code += b"\x04\x40"                              # if {
code += b"\x20\x0a\x20\x08\x6a\x21\x0a"          #   i += n
code += b"\x0c\x01"                              #   br 1 (continue)
code += b"\x0b"
code += b"\x41\x00\x21\x0b"                      # j = 0
code += b"\x02\x40"                              # block {
code += b"\x03\x40"                              #   loop {
code += b"\x20\x0b\x20\x09\x4f\x0d\x01"          #     j >= colour ? break
code += b"\x20\x00\x20\x0a\x20\x0b\x6a\x41\x04\x6c\x6a"      # addr
code += b"\x43\x00\x00\x80\x3f"                  #   1.0
code += b"\x20\x00\x20\x0a\x20\x0b\x6a\x41\x04\x6c\x6a"      # addr
code += b"\x2a\x02\x00"                          #   load
code += b"\x93"                                  #   f32.sub
code += b"\x38\x02\x00"                          #   store
code += b"\x20\x0b\x41\x01\x6a\x21\x0b"          #     j += 1
code += b"\x0c\x00"                              #     br 0
code += b"\x0b\x0b"                              #   } }
code += b"\x20\x0a\x20\x08\x6a\x21\x0a"          #   i += n
code += b"\x0c\x00"                              #   br 0
code += b"\x0b\x0b"                              #   } }
code += b"\x41\x00"                              # i32.const 0 (ok)
b_filter = body(b"\x01\x04" + bytes([I32]), bytes(code))   # 1 group, 4 i32 locals

code_sec = section(10, uleb(4) + b_abi + b_manifest + b_alloc + b_filter)

# ---------------------------------------------------------------- data
seg = uleb(1)
seg += b"\x00"                                   # active, memory 0
seg += b"\x41" + sleb(DATA_OFF) + b"\x0b"        # offset expr
seg += uleb(len(MANIFEST)) + MANIFEST
data_sec = section(11, seg)

wasm = b"\x00asm" + struct.pack("<I", 1) + type_sec + func_sec + memory_sec + export_sec + code_sec + data_sec

with open("demo-invert.wasm", "wb") as f:
    f.write(wasm)
print("wrote demo-invert.wasm", len(wasm), "bytes; manifest", len(MANIFEST), "bytes")
