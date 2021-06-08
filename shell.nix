with import (builtins.fetchTarball {
  name = "nixos-20.03";
  url = "https://github.com/NixOS/nixpkgs/archive/refs/tags/20.03.tar.gz";
  sha256 = "0182ys095dfx02vl2a20j1hz92dx3mfgz2a6fhn31bqlp1wa8hlq";
}) {};

haskell.lib.buildStackProject {
    name = "strato";
    buildInputs = [ zlib
                    lzma
                    leveldb
                    postgresql
                    pkg-config
                    libsodium
                    (pkgs.secp256k1.override { enableECDH = true; }) 
                    
                    # https://github.com/haskell/haskell-language-server/issues/1601
                    # https://github.com/haskell/haskell-language-server/issues/221
                    # glibc # Somehow we need HLS to use this glibc to solve ghc-prim errors!
                    ];
}
