# EKS template using AWS Elastic FileSystem (EFS) for volumes
This directory contains the additional templates required for deploying persistent volume using AWS EFS (elastic file system)

# Installing kubectl
Follow steps from [AWS documentation](https://docs.aws.amazon.com/eks/latest/userguide/install-kubectl.html)

# Delete Existing Resources (Deployement, EFS Storage Class, Persistent Volume Claims and Persistent Volumes)
kubectl delete deployment vault
kubectl delete sc efs-sc
kubectl delete pvc vault-idpconfig-data-pvc
kubectl delete pvc vault-postgres-data-pvc
kubectl delete pv vault-idpconfig-data-pv
kubectl delete pv vault-postgres-data-pv

**Note that** *vault* above is the name of the deployment.

# Create EFS Storage Class
kubectl apply -f efs-sc.yaml

# Create Persistence Volumes
kubectl apply -f vault-idpconfig-data-pv.yaml
kubectl apply -f vault-postgres-data-pv.yaml

# Create Persistence Volume Claims
kubectl apply -f vault-idpconfig-data-pvc.yaml
kubectl apply -f vault-postgres-data-pvc.yaml

# Create New Deployment
**Note:** Replace *REPO_URL and VERSION* in eks-vault-deployment.tpl.yaml file and rename it as *eks-vault-deployment.yaml*
kubectl apply -f eks-vault-deployment.yaml
