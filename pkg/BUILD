#!/bin/bash

set -e

#Set up input params

bindir=$builddir/usr/bin
stratohome=$builddir/var/lib/strato

################

mkdir -p $bindir
mkdir -p $stratohome

stack setup
stack install --local-bin-path=$bindir
stack build ethereum-test --test --no-run-tests
cp mkCoinbase $stratohome
cp strato-init/genesisBlocks/* $stratohome

cd $stratohome
mkdir -p node_modules
npm install blockapps-js yaml-parser

# Build our own solc because we need a specific version
solcdir=$workdir/solidity/build

if [[ -f $solcdir/Makefile ]]
then
  echo "$solcdir already exists, so solc was built.  Not rebuilding."
else
  rm -rf $workdir/solidity
  git -C $workdir clone --recursive --branch v0.3.6 https://github.com/ethereum/solidity.git
  mkdir -p $solcdir
  
  (
    cd $solcdir
    cmake -DCMAKE_INSTALL_PREFIX=$builddir/usr ..
    make -j4 solc
  )
fi
make -C $solcdir install

