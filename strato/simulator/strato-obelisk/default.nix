{ system ? builtins.currentSystem
, obelisk ? import ./.obelisk/impl {
    inherit system;
    iosSdkVersion = "13.2";

    # You must accept the Android Software Development Kit License Agreement at
    # https://developer.android.com/studio/terms in order to build Android apps.
    # Uncomment and set this to `true` to indicate your acceptance:
    # config.android_sdk.accept_license = false;

    # In order to use Let's Encrypt for HTTPS deployments you must accept
    # their terms of service at https://letsencrypt.org/repository/.
    # Uncomment and set this to `true` to indicate your acceptance:
    # terms.security.acme.acceptTerms = false;
  }
}:
with obelisk;
project ./. ({ pkgs, ... }: {
  android.applicationId = "systems.obsidian.obelisk.examples.minimal";
  android.displayName = "Obelisk Minimal Example";
  ios.bundleIdentifier = "systems.obsidian.obelisk.examples.minimal";
  ios.bundleName = "Obelisk Minimal Example";
  packages = {
    blockapps-data = ../../core/blockapps-data;
    blockapps-datadefs = ../../core/blockapps-datadefs;
    blockapps-mpdbs = ../../core/blockapps-mpdbs;
    blockstanbul = ../../core/blockstanbul;
    ethereum-discovery = ../../core/ethereum-discovery;
    ethereum-encryption = ../../core/ethereum-encryption;
    fast-keccak256 = ../../core/fast-keccak256;
    fastMP = ../../core/fastMP;
    merkle-patricia-db = ../../core/merkle-patricia-db;
    blockapps-privacy = ../../core/privacy;
    seqevents = ../../core/seqevents;
    # strato-adit = ../../core/strato-adit;
    strato-conf = ../../core/strato-conf;
    strato-genesis = ../../core/strato-genesis;
    strato-init = ../../core/strato-init;
    strato-model = ../../core/strato-model;
    # strato-networks = ../../core/strato-networks;
    strato-p2p = ../../core/strato-p2p;
    # strato-redis-blockdb = ../../core/strato-redis-blockdb;
    strato-sequencer = ../../core/strato-sequencer;
    strato-statediff = ../../core/strato-statediff;
    vm-runner = ../../core/vm-runner;
    vm-tools = ../../core/vm-tools;

    # slipstream = ../../indexer/slipstream;
    strato-index = ../../indexer/strato-index;

    blockapps-haskoin = ../../libs/blockapps-haskoin;
    clockwork = ../../libs/clockwork;
    common-log = ../../libs/common-log;
    ethereum-rlp = ../../libs/ethereum-rlp;
    format = ../../libs/format;
    labeled-error = ../../libs/labeled-error;
    logserver = ../../libs/logserver;
    # milena = ../../libs/kafka/milena;
    milena-tools = ../../libs/kafka/milena-tools;
    monad-alter = ../../libs/monad-alter;
    nibblestring = ../../libs/nibblestring;
    partitioner = ../../libs/partitioner;
    blockapps-init = ../../libs/prometheus/blockapps-init;
    # cross-monitoring = ../../libs/prometheus/cross-monitoring;
    secp256k1-haskell = ../../libs/secp256k1-haskell;
    type-lits = ../../libs/type-lits;
    x509-certs = ../../libs/x509-certs;
    strato-lite = ../../simulator/strato-lite;
    x509-tools = ../../tools/x509-tools;
    ethereum-vm = ../../VM/EVM/ethereum-vm;
    evm-solidity = ../../VM/EVM/evm-solidity;
    debugger = ../../VM/SolidVM/debugger;
    solid-vm = ../../VM/SolidVM/solid-vm;
    solid-vm-fuzzer = ../../VM/SolidVM/solid-vm-fuzzer;
    solid-vm-model = ../../VM/SolidVM/solid-vm-model;
    solid-vm-parser = ../../VM/SolidVM/solid-vm-parser;
    solid-vm-static-analysis = ../../VM/SolidVM/solid-vm-static-analysis;
    source-tools = ../../VM/SolidVM/source-tools;
  };
  overrides = self: super: let
      hpackHackage = self.callHackageDirect {
        pkg = "hpack";
        ver = "0.34.1";
        sha256 = "1xghyficc5fk6dpy60pbb4r09dfvil8jklssybd8567lhsq6zxbv";
      } {};
    in
    {
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
      relapse = self.callHackageDirect {
        pkg = "relapse";
        ver = "1.0.0.0";
        sha256 = "1hrv660hs50aadphg38wcrzf0admfdcfkp3zf7b2fcz58zlm431y";
      } {};
      hpack = pkgs.haskell.lib.dontCheck hpackHackage;
      servant = pkgs.haskell.lib.dontCheck super.servant;
      milena = pkgs.haskell.lib.dontCheck super.milena;
      strato-redis-blockdb = pkgs.haskell.lib.dontCheck super.strato-redis-blockdb;
      libsecp256k1 = ((import ./dep/libsecp256k1) self super);
      mkDerivation = drv: super.mkDerivation (drv // { jailbreak = true; doHaddock = false;});
  };
})