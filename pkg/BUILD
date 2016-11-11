#!/bin/bash

echo "Hello cirrus:BUILD"

set -e

cirrusdir=$builddir/usr/lib/strato
cirrushome=$cirrusdir/cirrus
projdir=$builddir/var/run/strato
projhome=$projdir/cirrus

npm set progress=false

mkdir -p $cirrushome
find -maxdepth 1 -mindepth 1 -name pkg -prune -o -execdir cp -a -t $cirrushome '{}' +
cd $cirrushome
rm -rf .git{,attributes,ignore}
npm update --quiet 

mkdir -p $projdir
cd $projdir
#rm -rf $projhome
#node $blochome/bin/main.js init --optIn --appName bloc-server --developer explorer --apiURL 'http://%APIURL%';
#cd $projhome
#npm install --quiet
#node node_modules/bower/bin/bower install --allow-root

