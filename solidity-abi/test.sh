#!/bin/bash

find $1 -name '*.sol' |
    xargs -n 1 bash -c "echo -e \"\n\$0: \"; cat \$0 | solidity-abi" 
