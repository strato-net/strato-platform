#!/usr/bin/env zsh
# Script to diagnose which dependencies are not in use for each child package.
# To use, please install zsh through your system package manager and packunused through stack.
# sudo apt install zsh
# stack install packunused
#
# This script will not remove redundant dependencies for your, but it will point out
# which packages have them in a sequential manner.
#
# NB: it would have been nice to build the whole project with "stack build --ghc-options=-ddump-minimal-imports",
# but I couldn't seem to get it to generate the ddump unless I specified which package I cared about.
#
# NB: packunused tends to mark `base` as redundant; these appear to be false positives.
function dump_package {
  echo "Building $1..."
  stack build $1 --ghc-options="-ddump-minimal-imports -O0" 1>/dev/null 2>/dev/null
  echo "$1 done"
  packunused
}

# packages are directories beneath . that have a cabal file
for package in $(find . -type f -name "*.cabal" | cut -d '/' -f 2 | grep -v ".stack-work" ); do
    cd $package
    dump_package $package
    cd ..
done
