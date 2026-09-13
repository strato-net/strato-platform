import { Stack, StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

export interface NetworkStackProps extends StackProps {
  vpcId?: string;
}

/**
 * The VPC the core cell runs in. Imports an existing one when `vpcId` is
 * given (the network.s VPC, so the cell can peer with the validators and reach Aurora over
 * private addresses); otherwise creates a small two-AZ VPC with one NAT.
 */
export class NetworkStack extends Stack {
  readonly vpc: ec2.IVpc;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);
    this.vpc = props.vpcId
      ? ec2.Vpc.fromLookup(this, "Vpc", { vpcId: props.vpcId })
      : new ec2.Vpc(this, "Vpc", {
          maxAzs: 2,
          natGateways: 1,
          subnetConfiguration: [
            { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
            { name: "private", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
          ],
        });
  }
}
