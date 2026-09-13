import { CfnOutput, Stack, StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import { Construct } from "constructs";

export interface CertificateStackProps extends StackProps {
  /** The hostname the certificate is for; its DNS zone is outside Route 53 (a registrar's console). */
  domainName: string;
}

/**
 * A DNS-validated ACM certificate for a hostname whose zone is not in
 * Route 53. CloudFormation holds the stack in CREATE_IN_PROGRESS until the
 * validation CNAME that ACM asks for exists at the registrar; the record is
 * in the stack's events and in `aws acm describe-certificate` as soon as the
 * certificate resource is created. Once issued, the certificate's ARN feeds
 * the tier that needs it through a stack reference.
 */
export class CertificateStack extends Stack {
  readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: CertificateStackProps) {
    super(scope, id, props);
    this.certificate = new acm.Certificate(this, "Certificate", {
      domainName: props.domainName,
      validation: acm.CertificateValidation.fromDns(),
    });
    new CfnOutput(this, "CertificateArn", { value: this.certificate.certificateArn });
    new CfnOutput(this, "DomainName", { value: props.domainName });
  }
}
