let
  pkgs = import <nixpkgs> {};
in
pkgs.mkShell {
  buildInputs = [ 
    pkgs.stack 
    pkgs.zlib
    pkgs.haskellPackages.postgresql-libpq
    pkgs.postgresql

  ];

  NIX_PATH = "nixpkgs=" + pkgs.path;

}




