import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";
import * as fs from "node:fs";
import * as path from "node:path";
import { AppTierConfig } from "./config";

export interface AppUiStackProps extends StackProps {
  config: AppTierConfig;
  loadBalancer: elbv2.IApplicationLoadBalancer;
  albUsesHttps: boolean;
}

/** Paths CloudFront sends to the app tier's nginx rather than the bucket. */
const API_PATHS = ["/api/*", "/api-docs*", "/auth/*", "/login", "/rpc", "/_ping"];

/**
 * The app UI: the built Vite bundle in a private bucket behind CloudFront,
 * with the API, auth and RPC paths routed to the app tier's load balancer so
 * the browser sees one origin, exactly as it did behind the node's nginx.
 */
export class AppUiStack extends Stack {
  constructor(scope: Construct, id: string, props: AppUiStackProps) {
    super(scope, id, props);
    const { config } = props;

    const bucket = new s3.Bucket(this, "UiBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const albOrigin = new origins.LoadBalancerV2Origin(props.loadBalancer, {
      protocolPolicy: props.albUsesHttps ? cloudfront.OriginProtocolPolicy.HTTPS_ONLY : cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      readTimeout: Duration.seconds(60),
    });
    const apiBehavior: cloudfront.BehaviorOptions = {
      origin: albOrigin,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      // Cookies, auth headers and query strings all reach nginx unchanged.
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    };

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: `strato app ${config.envName}`,
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: Object.fromEntries(API_PATHS.map((p) => [p, apiBehavior])),
      // Client-side routes: the bucket has no such objects, the SPA does.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: Duration.seconds(0) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: Duration.seconds(0) },
      ],
      ...(config.domainName && config.cloudfrontCertificateArn
        ? {
            domainNames: [config.domainName],
            certificate: acm.Certificate.fromCertificateArn(this, "CfCert", config.cloudfrontCertificateArn),
            minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
          }
        : {}),
    });

    // The bundle is built outside CDK (`npm run build` in app/ui); config.js is
    // rendered here from context, matching app/ui/render-config.sh.
    const dist = path.resolve(__dirname, "../../../app/ui/dist");
    if (config.deployUi) {
      if (!fs.existsSync(path.join(dist, "index.html"))) {
        throw new Error(`deployUi is set but ${dist} has no build; run "npm run build" in app/ui first`);
      }
      const configJs = [
        "window.ENV = {",
        `  CHAIN_ID: ${config.chainId},`,
        `  NETWORK_NAME: "${config.networkName}",`,
        `  POSTHOG_KEY: "${config.backendEnvironment.POSTHOG_KEY ?? ""}",`,
        `  POSTHOG_HOST: "${config.backendEnvironment.POSTHOG_HOST ?? ""}",`,
        `  GOOGLE_ANALYTICS_ID: "${config.backendEnvironment.GOOGLE_ANALYTICS_ID ?? ""}"`,
        "};",
        "",
      ].join("\n");
      new s3deploy.BucketDeployment(this, "UiDeployment", {
        destinationBucket: bucket,
        sources: [s3deploy.Source.asset(dist, { exclude: ["config.js"] }), s3deploy.Source.data("config.js", configJs)],
        distribution,
        distributionPaths: ["/*"],
        prune: true,
      });
    }

    new CfnOutput(this, "DistributionDomainName", { value: distribution.distributionDomainName });
    new CfnOutput(this, "UiBucketName", { value: bucket.bucketName });
  }
}
