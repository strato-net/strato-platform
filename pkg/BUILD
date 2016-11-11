#!/bin/bash

set -e

blocdir=$builddir/usr/lib/strato
blochome=$blocdir/bloc-server
projdir=$builddir/var/run/strato
projhome=$projdir/bloc-server

npm set progress=false

mkdir -p $blochome
find -maxdepth 1 -mindepth 1 -name pkg -prune -o -execdir cp -a -t $blochome '{}' +
cd $blochome
rm -rf .git{,attributes,ignore}
npm update --quiet 

mkdir -p $projdir
cd $projdir
rm -rf $projhome
node $blochome/bin/main.js init --optIn --appName bloc-server --developer explorer --apiURL 'http://%APIURL%';
cd $projhome
npm install --quiet
node node_modules/bower/bin/bower install --allow-root

