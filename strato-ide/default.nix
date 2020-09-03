{ obelisk ? import ./.obelisk/impl {
    system = builtins.currentSystem;
    iosSdkVersion = "10.2";
    # You must accept the Android Software Development Kit License Agreement at
    # https://developer.android.com/studio/terms in order to build Android apps.
    # Uncomment and set this to `true` to indicate your acceptance:
    # config.android_sdk.accept_license = false;
  }
}:
with obelisk;
project ./. ({ pkgs, hackGet, ... }: {
  android.applicationId = "systems.obsidian.obelisk.examples.minimal";
  android.displayName = "Obelisk Minimal Example";
  ios.bundleIdentifier = "systems.obsidian.obelisk.examples.minimal";
  ios.bundleName = "Obelisk Minimal Example";
  packages = {
    reflex-dom-ace = hackGet ./deps/reflex-dom-ace;
    blockapps-bloc22-api = ../blockapps-haskell/bloc/bloc22/api;
    blockapps-bloc22-server = ../blockapps-haskell/bloc/bloc22/server;
    blockapps-data = ../core-strato/blockapps-data;
    blockapps-datadefs = ../core-strato/blockapps-datadefs;
    blockapps-ethereum = ../blockapps-haskell/ethereum;
    blockapps-haskoin = ../core-strato/blockapps-haskoin;
    blockapps-init = ../shared-util/blockapps-init;
    blockapps-mpdbs = ../core-strato/blockapps-mpdbs;
    blockapps-solidity = ../blockapps-haskell/solidity;
    blockapps-strato-api = ../blockapps-haskell/strato/api;
    blockapps-strato-client = ../blockapps-haskell/strato/client; blockapps-tools = ../core-strato/blockapps-tools;
    blockapps-util = ../core-strato/blockapps-util;
    blockapps-vault-wrapper-api = ../blockapps-haskell/vault-wrapper/api;
    blockapps-vault-wrapper-client = ../blockapps-haskell/vault-wrapper/client;
    blockstanbul = ../core-strato/blockstanbul;
    common-log = ../shared-util/common-log;
    core-api = ../core-strato/core-api;
    cross-monitoring = ../shared-util/cross-monitoring;
    ethereum-discovery = ../core-strato/ethereum-discovery;
    ethereum-encryption = ../core-strato/ethereum-encryption;
    ethereum-rlp = ../core-strato/ethereum-rlp;
    fast-keccak256 = ../core-strato/fast-keccak256;
    fastMP = ../core-strato/fastMP;
    format = ../shared-util/format;
    haskoin-shim = ../shared-util/haskoin-shim;
    merkle-patricia-db = ../core-strato/merkle-patricia-db;
    milena = ../core-strato/milena;
    monad-alter = ../monad-alter;
    seqevents = ../core-strato/seqevents;
    slipstream = ../blockapps-haskell/slipstream;
    solid-vm = ../core-strato/solid-vm;
    solid-vm-model = ../shared-util/solid-vm-model;
    strato-adit = ../core-strato/strato-adit;
    strato-conf = ../core-strato/strato-conf;
    strato-index = ../core-strato/strato-index;
    strato-model = ../core-strato/strato-model;
    strato-redis-blockdb = ../core-strato/strato-redis-blockdb;
    vm-tools = ../core-strato/vm-tools;
  };
  overrides = self: super: let
      nibblestringSrc = pkgs.fetchFromGitHub {
        owner = "dustinnorwood";
        repo = "nibblestring";
        rev = "862120993fd44f73853b04e81136306e33f6e58e";
        sha256 = "111cy89zyckdc2hp3y327prwibyshjkypcgfgp6jf5ylcjw5clfk";
      };
      hpackHackage = self.callHackageDirect {
        pkg = "hpack";
        ver = "0.34.1";
        sha256 = "1xghyficc5fk6dpy60pbb4r09dfvil8jklssybd8567lhsq6zxbv";
      } {};
      postgresql-typedHackage = self.callHackageDirect {
        pkg = "postgresql-typed";
        ver = "0.6.1.2";
        sha256 = "037nhi4lbrvpa6s99d77858xm2rlkzciyv9ar6vq168igjl1ffvd";
      } {};
    in
    {
      bimap = super.callHackageDirect {
        pkg = "bimap";
        ver = "0.4.0";
        sha256 = "1jhnqzp1fa876abz0v6adkp9bl24zjnn0sdy8cxkpl1y8j62pcm8";
      } {};
      haskell-src-exts = super.callHackageDirect {
        pkg = "haskell-src-exts";
        ver = "1.20.3";
        sha256 = "15jl7xn8x3bf38npzhl9pgjwzq7w73qsgr23y6axnn6m19yshyqz";
       } {};
      hlint = super.callHackageDirect {
        pkg = "hlint";
        ver = "2.1.11";
        sha256 = "053fcyzvlyl0xvf9jn2ff7kjqmmk78mkdbpnvzs1d1qbp5dfza9p";
       } {};
      ansi-wl-pprint = super.callHackageDirect {
        pkg = "ansi-wl-pprint";
        ver = "0.6.9";
        sha256 = "08akbbdra1sx36ff1la5k7rcxlz543i86qk4gyyxbxy636m9fhwv";
      } {};
      derive = self.callHackageDirect {
        pkg = "derive";
        ver = "2.6.5";
        sha256 = "0rcvkcv99bns7l0zxk7sv5027i40cdwv0cl0vsvcqi6zbziag5df";
      } {};
      nibblestring = self.callCabal2nix "nibblestring" nibblestringSrc {};
      relapse = self.callHackageDirect {
        pkg = "relapse";
        ver = "1.0.0.0";
        sha256 = "1hrv660hs50aadphg38wcrzf0admfdcfkp3zf7b2fcz58zlm431y";
      } {};
      servant-multipart = self.callHackageDirect {
        pkg = "servant-multipart";
        ver = "0.11.5";
        sha256 = "0l2cajsyxiq3zsn5scqw82j635dvkbr90vp68cnn0pbdapi8krj0";
      } {};
      blockapps-bloc22-server = pkgs.haskell.lib.dontCheck super.blockapps-bloc22-server;
      blockapps-strato-client = pkgs.haskell.lib.dontCheck super.blockapps-strato-client;
      hpack = pkgs.haskell.lib.dontCheck hpackHackage;
      milena = pkgs.haskell.lib.dontCheck super.milena;
      postgresql-typed = pkgs.haskell.lib.dontCheck postgresql-typedHackage;
      servant = pkgs.haskell.lib.dontCheck super.servant;
      strato-redis-blockdb = pkgs.haskell.lib.dontCheck super.strato-redis-blockdb;
      mkDerivation = drv: super.mkDerivation (drv // { jailbreak = true; doHaddock = false;});
  };
})
