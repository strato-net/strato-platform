# What is EKS
Amazon Elastic Kubernetes Service (Amazon EKS) is a managed service that we can use to run Kubernetes on AWS without needing to install, operate, and maintain our own Kubernetes control panel. More detailed information can be found [here](https://docs.aws.amazon.com/eks/latest/userguide/what-is-eks.html)

# Installing kubectl
Follow steps from [AWS documentation](https://docs.aws.amazon.com/eks/latest/userguide/install-kubectl.html)

# AWS EBS for volumes
This template uses AWS EBS volumes for container volumes. For AWS EFS volumes see the ./efs subfolder

# Delete Existing Resources (Deployement, EFS Storage Class, Persistent Volume Claims and Persistent Volumes)
kubectl delete -f strato-platform-manifest.yaml

# Make a copy of the template
cp strato-platform-manifest.tpl.yaml strato-platform-manifest.yaml

# Download the strato-platform-manifest.yaml file from jenkins build artifact in your local.
Replace below place holders with valid values:
* *REPLACE_WITH_OAUTH_CLIENT_ID*
* *REPLACE_WITH_OAUTH_CLIENT_SECRET*
* *REPLACE_WITH_EXT_STORAGE_S3_ACCESS_KEY_ID*
* *REPLACE_WITH_EXT_STORAGE_S3_SECRET_ACCESS_KEY*
* *REPLACE_WITH_STRIPE_PUBLISHABLE_KEY*
* *REPLACE_WITH_STRIPE_SECRET_KEY*
* *REPLACE_WITH_VERSION*

# Create genesis block
kubectl create configmap genesis-block --from-file=genesis-block.json -n strato-platform

# Execute the manifest file
kubectl apply -f strato-platform-manifest.yaml
