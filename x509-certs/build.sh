#!/bin/bash


set -e
printf "Building x509 cert-gen tool\n"
stack build x509-certs
cp .stack-work/dist/x86_64-linux-dkf7b33dd99b569c2d0a323e8a6dc29e94/Cabal-2.2.0.1/build/x509certs/x509certs artifacts/.
printf "Done. Run artifacts/x509certs\n"
