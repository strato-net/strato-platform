#!/bin/sh

AWS_ACCESS_KEY_ID=$1 AWS_SECRET_ACCESS_KEY=$2 AWS_DEFAULT_REGION=$3 aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 406773134706.dkr.ecr.us-east-1.amazonaws.com

declare -a arr=("smd" "apex" "vault-wrapper", "strato", "postgrest", "nginx", "prometheus")

for image in "${arr[@]}"
do
   echo "pushing image $image"
   # or do whatever with individual element of the array
   docker tag <REPO_URL>"$image":<VERSION> 406773134706.dkr.ecr.us-east-1.amazonaws.com/smd:<VERSION>
   docker push 406773134706.dkr.ecr.us-east-1.amazonaws.com/"$image":<VERSION>
done
