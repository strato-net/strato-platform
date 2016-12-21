#!/bin/bash
set -e

. set-params.sh

echo "Removing all images"

for name in ${ourImages[@]}
  do 
    imageName=${name}Image
    image=${!imageName}
    docker rmi  $image
  done

exit 0
