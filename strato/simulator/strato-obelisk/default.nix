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
project ./. ({ ... }: {
  android.applicationId = "systems.obsidian.obelisk.examples.minimal";
  android.displayName = "Obelisk Minimal Example";
  ios.bundleIdentifier = "systems.obsidian.obelisk.examples.minimal";
  ios.bundleName = "Obelisk Minimal Example";
  packages = {
    strato-lite = ../strato-lite;
    blockapps-data = ../../core/blockapps-data;
    blockapps-datadefs = ../../core/blockapps-datadefs;
    blockapps-haskoin = ../../libs/blockapps-haskoin;
    blockapps-init = ../../libs/prometheus/blockapps-init;
    blockapps-mpdbs = ../../core/blockapps-mpdbs;
    blockapps-tools = ../../tools/blockapps-tools;
    blockstanbul = ../../core/blockstanbul;
    common-log = ../../libs/common-log;
    cross-monitoring = ../../libs/prometheus/cross-monitoring;
    ethereum-discovery = ../../core/ethereum-discovery;
    ethereum-encryption = ../../core/ethereum-encryption;
    ethereum-rlp = ../../libs/ethereum-rlp;
    fast-keccak256 = ../../core/fast-keccak256;
    fastMP = ../../core/fastMP;
    format = ../../libs/format;
    merkle-patricia-db = ../../core/merkle-patricia-db;
    milena = ../../libs/milena;
    monad-alter = ../../libs/monad-alter;
    seqevents = ../../core/seqevents;
    solid-vm = ../../VM/SolidVM/solid-vm;
    solid-vm-model = ../../VM/SolidVM/solid-vm-model;
    strato-conf = ../../core/strato-conf;
    strato-index = ../../indexer/strato-index;
    strato-model = ../../core/strato-model;
    strato-redis-blockdb = ../../core/strato-redis-blockdb;
    vm-tools = ../../core/vm-tools;
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
      nibblestring = self.callCabal2nix "nibblestring" nibblestringSrc {};
      relapse = self.callHackageDirect {
        pkg = "relapse";
        ver = "1.0.0.0";
        sha256 = "1hrv660hs50aadphg38wcrzf0admfdcfkp3zf7b2fcz58zlm431y";
      } {};
      hpack = pkgs.haskell.lib.dontCheck hpackHackage;
      servant = pkgs.haskell.lib.dontCheck super.servant;
      milena = pkgs.haskell.lib.dontCheck super.milena;
      strato-redis-blockdb = pkgs.haskell.lib.dontCheck super.strato-redis-blockdb;
      mkDerivation = drv: super.mkDerivation (drv // { jailbreak = true; doHaddock = false;});
  };
})