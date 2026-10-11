import { App, Tags } from "aws-cdk-lib";

// Every AWS name a deployment creates starts with `ha-<envName>`: its stack
// names, and through them the names CloudFormation generates, plus every
// explicitly named resource, secret, parameter and log group. The same value
// is the Deployment tag, which also reaches what has no name (EBS volumes,
// subnets, KMS keys). Each CDK app carries a copy of this file.

/** `ha-<envName>`; envName is short lowercase so load balancer names fit 32 characters. */
export function deploymentPrefix(envName: string): string {
  if (!/^[a-z][a-z0-9-]{0,14}[a-z0-9]$/.test(envName)) {
    throw new Error(`envName must be 2 to 16 lowercase letters, digits or hyphens, starting with a letter and not ending with a hyphen: got "${envName}"`);
  }
  return `ha-${envName}`;
}

/** Load balancer and target group names are limited to 32 characters. */
export function elbName(name: string): string {
  if (name.length > 32) throw new Error(`"${name}" is longer than the 32 characters a load balancer or target group name allows: shorten envName`);
  return name;
}

/** The Deployment and ManagedBy tags on every taggable resource of the app. */
export function tagDeployment(app: App, envName: string): void {
  Tags.of(app).add("Deployment", deploymentPrefix(envName));
  Tags.of(app).add("ManagedBy", "ha-infra");
}
