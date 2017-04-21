#!/bin/bash

stratoHost=${stratoHost:-$(curl -s ident.me)}
canonicalHost=$(getent hosts $stratoHost | tr -s ' ' | cut -d ' ' -f 2)
if [[ $stratoHost == "0.0.0.0" || $canonicalHost == "localhost" ]]
then stratoHost="strato:3000"
fi

cd /var/run/strato/bloc-server
blocserver="/usr/lib/strato/bloc-server/bin/main.js"
apiUrl=${apiUrlOverride:-"http$(${ssl:-false} && echo "s")://$stratoHost/strato-api"}
sed -i "s|^apiURL: .*\$|apiURL: '$apiUrl'|" config.yaml
HOST=0.0.0.0 exec $blocserver start
