#!/bin/bash




function cirrus-count {
  for i in $(curl -s localhost/cirrus/search/ | jq '.[] | [.name]' | grep \" | sed 's/  \"//g' | sed 's/\"//g' )
    do 
      printf \\n$i\\t
      curl -s localhost/cirrus/search/$i?select=count | jq -C '.[]' | grep \" | sed 's/  \"//g' | sed 's/\"//g'
    done
}

function explorer-blocktimes {
  curl -s localhost/strato-api/eth/v1.2/block/last/100| jq '.[] | {blockData}' | grep 'timestamp' | cut -d : -f2,3,4 | cut -d , -f1 | xargs -L1 -I x date -d x +'%s' | awk '{$2 = $1 - prev1; prev1 = $1; print;}' | cut -d ' ' -f2 | tail -n +2 | spark | awk -F":" '{ print $1 "\tblocktimes"}'
}

function explorer-numtxs {
  curl -s localhost/strato-api/eth/v1.2/block/last/100 | jq '.[] | [.receiptTransactions | length] ' | grep -o '[0-9]*' | spark | awk -F":" '{ print $1 "\tnumber of transactions per block"}'
}

function explorer-numuncles {
  curl -s localhost/strato-api/eth/v1.2/block/last/100 | jq '.[] | [.blockUncles | length] ' | grep -o '[0-9]*' | spark | awk -F":" '{ print $1 "\tnumber of uncles per block"}'
}

case $1 in
  "cirrus-count")
    echo "Cirrus contract counts"
    cirrus-count
    ;;

  "explorer-blocktimes")
    echo "Blocktimes"
    explorer-blocktimes
    ;;

  "explorer-numtxs")
    echo "Number of transactions per block"
    explorer-numtxs
    ;;
  "explorer-numuncles")
    echo "Number of uncles per block"
    explorer-numuncles
    ;;
  *)
    echo "help"
    ;;
esac
