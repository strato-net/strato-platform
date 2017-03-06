#!/bin/bash




function cirrus-count {
  for i in $(curl -s localhost/cirrus/search/ | jq '.[] | [.name]' | grep \" | sed 's/  \"//g' | sed 's/\"//g' )
    do 
      printf \\n$i
      curl -s localhost/cirrus/search/$i?select=count | jq '.[]' | grep \" | sed 's/  \"//g' | sed 's/\"//g'
    done
}

function explorer-blocktimes {
  curl -s localhost/strato-api/eth/v1.2/block/last/100| jq '.[] | {blockData}' | grep 'timestamp' | cut -d : -f2,3,4 | cut -d , -f1 | xargs -L1 -I x date -d x +'%s' | awk '{$2 = $1 - prev1; prev1 = $1; print;}' | cut -d ' ' -f2 | tail -n +2 | spark | awk -F":" '{ print $1 "\tblocktimes"}'
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
  *)
    echo "help"
    ;;
esac
