#!/bin/bash                                                                                                        

set -e

for i in `seq 1 100`; do
    echo $i
    sleep 5
    time curl -d 'addresses=["aa","bb","cc","dd","ee","ff","aaa","bbb","ccc","ddd"]' http://localhost:3000/eth/v1.2/faucet &
    echo "$((10*i))" "transactions delivered in" $SECONDS
done
