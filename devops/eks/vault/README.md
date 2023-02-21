# What is EKS
Amazon Elastic Kubernetes Service (Amazon EKS) is a managed service that we can use to run Kubernetes on AWS without needing to install, operate, and maintain our own Kubernetes control panel. More detailed information can be found [here](https://docs.aws.amazon.com/eks/latest/userguide/what-is-eks.html)

# Installing kubectl
Follow steps from [AWS documentation](https://docs.aws.amazon.com/eks/latest/userguide/install-kubectl.html)

# AWS EBS for volumes
This template uses AWS EBS volumes for container volumes. For AWS EFS volumes see the ./efs subfolder

# Delete Existing Resources (Deployement, EFS Storage Class, Persistent Volume Claims and Persistent Volumes)
kubectl delete deployment vault
**Note that** *vault* above is the name of the deployment.

# Create New Deployment
**Note:** Replace *REPO_URL and VERSION* in eks-vault-deployment.tpl.yaml file and rename it as *eks-vault-deployment.yaml*
cp eks-vault-deployment.tpl.yaml eks-vault-deployment.yaml
kubectl apply -f eks-vault-deployment.yaml
