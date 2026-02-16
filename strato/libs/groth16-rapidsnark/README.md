# groth16-rapidsnark

Native Groth16 prover with built-in witness calculation. No Node.js or snarkjs required!

## Features

- **Native witness calculation** using wasm3 (embedded WASM interpreter)
- **Native proof generation** using rapidsnark (C++ FFI)
- **Zero external dependencies** - just `stack build` and it works
- **Cross-platform** - works on Linux and macOS

## Setup

No setup required! This package builds everything from vendored source automatically.

```bash
stack build groth16-rapidsnark
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

This package vendors:
1. **wasm3** - A lightweight C WASM interpreter for witness calculation
2. **rapidsnark** - A fast C++ Groth16 prover

Both are compiled as part of the normal Haskell build process. No cmake, nasm,
Node.js, or other external tools required.

## Usage

```haskell
import Groth16.Prover
import Groth16.Witness

main = do
  -- Calculate witness from circuit inputs (native wasm3)
  let witnessConfig = defaultWitnessConfig 
        { wcCircuitWasm = "path/to/circuit.wasm" }
  witnessResult <- calculateWitness witnessConfig inputJson
  
  case witnessResult of
    Left err -> print err
    Right witnessBytes -> do
      -- Generate proof from witness (native rapidsnark FFI)
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
│ Witness Calculator│  ← Native wasm3 (embedded C WASM interpreter)
│   (circuit.wasm)  │    Executes circom WASM natively
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

However, it includes third-party software:
- **rapidsnark**: LGPL v3
- **wasm3**: MIT

See `NOTICE.md` for compliance information.

## Performance Notes

The generic C++ field arithmetic in rapidsnark is slower than the 
assembly-optimized version:
- Assembly version: ~1 second for typical circuits
- Generic C++ version: ~3-5 seconds for typical circuits

wasm3 is an interpreter, so witness calculation may be slightly slower than
native WASM runtimes like wasmer, but still very fast (~100-500ms for most circuits).

Total proof generation time is typically 3-6 seconds, which is acceptable for
most use cases and much faster than pure Haskell implementations (~45+ seconds).
