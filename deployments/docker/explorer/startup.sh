#!/bin/bash

blochost=$fqdn/bloc

cd /usr/lib/strato/explorer

>server/api/node/nodes.yml
echo "- http://$blochost/" >server/api/keyserver/blocserver.yml
exec node server/index.js

