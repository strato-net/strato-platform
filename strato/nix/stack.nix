let
  # Pin nixpkgs to a specific commit for reproducibility
  nixpkgs = fetchTarball {
    url = "https://github.com/NixOS/nixpkgs/archive/nixos-24.05.tar.gz";
    sha256 = "0zydsqiaz8qi4zd63zsb2gij2p614cgkcaisnk11wjy3nmiq0x1s";
  };
  pkgs = import nixpkgs {};
in
pkgs.mkShell {
  buildInputs = with pkgs; [
    # Build tools
    stack
    pkg-config
    
    # System libraries matching Ubuntu dependencies
    leveldb        # libleveldb-dev
    xz            # liblzma-dev  
    postgresql    # libpq-dev and postgresql-client
    secp256k1     # libsecp256k1-dev
    libsodium     # libsodium-dev
    
    # Additional development dependencies
    zlib
    openssl
    gmp
    ncurses
    
    # PostgreSQL client tools
    postgresql.lib
  ];

  # Environment variables for build tools
  shellHook = ''
    export PKG_CONFIG_PATH="${pkgs.lib.getDev pkgs.postgresql}/lib/pkgconfig:${pkgs.lib.getDev pkgs.openssl}/lib/pkgconfig:${pkgs.lib.getDev pkgs.zlib}/lib/pkgconfig:${pkgs.libsodium}/lib/pkgconfig:${pkgs.leveldb}/lib/pkgconfig:${pkgs.secp256k1}/lib/pkgconfig:$PKG_CONFIG_PATH"
    export LD_LIBRARY_PATH="${pkgs.lib.getLib pkgs.postgresql}/lib:${pkgs.lib.getLib pkgs.openssl}/lib:${pkgs.lib.getLib pkgs.zlib}/lib:${pkgs.libsodium}/lib:${pkgs.leveldb}/lib:${pkgs.secp256k1}/lib:$LD_LIBRARY_PATH"
    export C_INCLUDE_PATH="${pkgs.lib.getDev pkgs.postgresql}/include:${pkgs.lib.getDev pkgs.openssl}/include:${pkgs.lib.getDev pkgs.zlib}/include:${pkgs.libsodium}/include:${pkgs.leveldb}/include:${pkgs.secp256k1}/include:$C_INCLUDE_PATH"
    
    echo "Development environment loaded with:"
    echo "  - Stack build tool"
    echo "  - PostgreSQL ${pkgs.postgresql.version}"
    echo "  - LevelDB ${pkgs.leveldb.version}"
    echo "  - libsodium ${pkgs.libsodium.version}"
    echo "  - secp256k1 ${pkgs.secp256k1.version}"
    echo "  - All other required system dependencies"
  '';

  NIX_PATH = "nixpkgs=" + nixpkgs;
}




