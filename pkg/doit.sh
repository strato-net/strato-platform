#!/bin/bash

echo "Hello cirrus:doit-prod.sh"

stratoHost=${stratoHost:-$(curl -s ident.me)}

cirrus="/usr/lib/strato/cirrus/main.js"
node $cirrus
