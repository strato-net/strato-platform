#!/bin/bash


set -e
printf "Building x509 test program\n"
stack build x509-certs
cp .stack-work/dist/x86_64-linux-dkf7b33dd99b569c2d0a323e8a6dc29e94/Cabal-2.4.0.1/build/x509Test/x509Test ./
printf "\n\nDone. ./x509Test\n"
