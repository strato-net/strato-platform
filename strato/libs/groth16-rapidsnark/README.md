# groth16-rapidsnark-ffi

Native FFI bindings to [rapidsnark](https://github.com/iden3/rapidsnark) for fast Groth16 proof generation.

## Setup

No setup required! This package builds rapidsnark from vendored C++ source automatically.

Just run:
```bash
stack build groth16-rapidsnark-ffi
```

### System Dependencies

Your system needs:
- `g++` (C++ compiler)
- `libgmp-dev` (GNU Multiple Precision Arithmetic Library)

On Ubuntu/Debian:
```bash
apt-get install g++ libgmp-dev
```

On macOS:
```bash
brew install gmp
```

## How it Works

This package vendors the rapidsnark source code and compiles it as part of the
normal Haskell build process. It uses the **generic C++ implementation** of
field arithmetic (not the assembly-optimized version), which means:

- No cmake or nasm required
- Works on any platform with a C++ compiler
- Cross-platform compatible (Linux, macOS)
- Slightly slower than assembly version but still fast (~few seconds for typical circuits)

## Usage

```haskell
import Groth16.Prover
import Groth16.Witness

main = do
  -- Calculate witness from circuit inputs (still uses snarkjs for now)
  let witnessConfig = defaultWitnessConfig 
        { wcCircuitWasm = "path/to/circuit.wasm" }
  witnessResult <- calculateWitness witnessConfig inputJson
  
  case witnessResult of
    Left err -> print err
    Right witnessBytes -> do
      -- Generate proof from witness (uses native FFI)
      let proverConfig = defaultConfig 
            { pcProvingKey = "path/to/circuit.zkey" }
      proofResult <- generateProofFromWitness proverConfig witnessBytes
      case proofResult of
        Left err -> print err
        Right proof -> print proof
```

## Architecture

```
Circuit Inputs (JSON)
        │
        ▼
┌───────────────────┐
│ Witness Calculator│  ← Currently uses snarkjs
│   (circuit.wasm)  │    Future: native WASM runtime
└───────────────────┘
        │
        ▼
   Witness (.wtns)
        │
        ▼
┌───────────────────┐
│    rapidsnark     │  ← Native FFI (compiled from C++ source)
│  (Groth16 prover) │
└───────────────────┘
        │
        ▼
   Proof (JSON)
```

## License

This package is proprietary (AllRightsReserved).

However, it includes rapidsnark which is licensed under **LGPL v3**.
See `NOTICE.md` for compliance information.

## Performance Notes

The generic C++ field arithmetic is slower than the assembly-optimized version:
- Assembly version: ~1 second for typical circuits
- Generic C++ version: ~3-5 seconds for typical circuits

This is still much faster than pure Haskell implementations (~45+ seconds)
and acceptable for most use cases.

## Future Work

To fully eliminate the Node.js dependency for witness calculation:

1. **Haskell WASM runtime**: Use wasmer-hs or wasmtime bindings
2. **wasm3 FFI**: Include the lightweight wasm3 C interpreter
3. **C++ witness calculator**: Generate with `circom --c` and include via FFI
