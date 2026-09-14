import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";
import * as fs from "node:fs";
import * as path from "node:path";
import { ApiTierConfig } from "./config";

export interface FrontDoorStackProps extends StackProps {
  config: ApiTierConfig;
  /** The us-east-1 certificate for `config.frontDoorDomainName`, also attached to both tiers' ALBs. */
  certificate: acm.ICertificate;
}

/** The app backend's paths: the app tier's nginx. */
const APP_PATHS = ["/api-docs*", "/api/*", "/history-api/*"];

/**
 * The node API, apex, RPC, docs and login paths: this tier's nginx. Login and
 * logout live here for both UIs (the node template honors returnTo), as they
 * did on a single node; the app tier's nginx reads the same session cookie.
 */
const API_PATHS = ["/strato/*", "/strato-api*", "/bloc/*", "/cirrus/*", "/apex-api*", "/apex-ws/*", "/rpc*", "/docs*", "/login*", "/auth/*", "/csrf-init", "/health", "/_ping"];

/**
 * Viewer-request functions for the two buckets. Client-side routes (no file
 * extension in the last segment) get their SPA's index.html. Functions rather
 * than the distribution's error responses, which would also rewrite the tiers'
 * own 401s, 403s and 404s into HTML.
 */
const APP_ROUTES = `
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.slice(uri.lastIndexOf("/") + 1).indexOf(".") === -1) {
    request.uri = "/index.html";
  }
  return request;
}
`;
const SMD_ROUTES = `
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri === "/smd") {
    return { statusCode: 302, statusDescription: "Found", headers: { location: { value: "/smd/" } } };
  }
  if (uri.slice(uri.lastIndexOf("/") + 1).indexOf(".") === -1) {
    request.uri = "/smd/index.html";
  }
  return request;
}
`;

/**
 * One hostname for every UI, as a single node serves them: the app UI at /,
 * the SMD at /smd/, the app backend under /api, and the node API, apex, RPC,
 * docs and login on the API tier. CloudFront forwards the viewer's Host header
 * to both ALBs so login redirects and cookies stay on this hostname; each ALB
 * therefore carries this hostname's certificate. Both tiers' nginx must share
 * the session secret and OAuth client, and run stateless CSRF (see README).
 */
export class FrontDoorStack extends Stack {
  constructor(scope: Construct, id: string, props: FrontDoorStackProps) {
    super(scope, id, props);
    const { config } = props;
    if (!config.frontDoorDomainName) throw new Error("FrontDoorStack needs frontDoorDomainName");
    if (!config.domainName) throw new Error("FrontDoorStack reaches this tier by its hostname over https: set domainName");
    if (!config.appOriginDomainName) throw new Error("FrontDoorStack needs appOriginDomainName (the app tier ALB's DNS name or hostname, serving https)");

    const bucketProps: s3.BucketProps = {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    };
    const appBucket = new s3.Bucket(this, "AppUiBucket", bucketProps);
    const smdBucket = new s3.Bucket(this, "SmdBucket", bucketProps);

    const tierBehavior = (domainName: string): cloudfront.BehaviorOptions => ({
      origin: new origins.HttpOrigin(domainName, {
        protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
        readTimeout: Duration.seconds(60),
      }),
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      // Host, cookies, auth headers and query strings reach nginx unchanged.
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    });
    const appTier = tierBehavior(config.appOriginDomainName);
    const apiTier = tierBehavior(config.domainName);

    const fn = (fid: string, comment: string, code: string) =>
      new cloudfront.Function(this, fid, { runtime: cloudfront.FunctionRuntime.JS_2_0, comment, code: cloudfront.FunctionCode.fromInline(code) });
    const smdBehavior: cloudfront.BehaviorOptions = {
      origin: origins.S3BucketOrigin.withOriginAccessControl(smdBucket),
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      functionAssociations: [{ function: fn("SmdRoutes", `strato front door ${config.envName}: smd routes`, SMD_ROUTES), eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
    };

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: `strato front door ${config.envName}`,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(appBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [{ function: fn("AppRoutes", `strato front door ${config.envName}: app routes`, APP_ROUTES), eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        "/smd": smdBehavior,
        "/smd/*": smdBehavior,
        ...Object.fromEntries(APP_PATHS.map((p) => [p, appTier])),
        ...Object.fromEntries(API_PATHS.map((p) => [p, apiTier])),
      },
      domainNames: [config.frontDoorDomainName],
      certificate: props.certificate,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    });

    // The bundles are built outside CDK; each config.js is rendered here from
    // context, matching app/ui/render-config.sh and smd-ui/docker-run.sh.
    if (config.deployAppUi) {
      const dist = path.resolve(__dirname, "../../../app/ui/dist");
      if (!fs.existsSync(path.join(dist, "index.html"))) throw new Error(`deployAppUi is set but ${dist} has no build; run "npm run build" in app/ui first`);
      if (!config.chainId || !config.networkName) throw new Error("deployAppUi needs -c chainId=... and -c networkName=...");
      const configJs = [
        "window.ENV = {",
        `  CHAIN_ID: ${config.chainId},`,
        `  NETWORK_NAME: "${config.networkName}",`,
        `  POSTHOG_KEY: "${config.appUiPosthogKey ?? ""}",`,
        `  POSTHOG_HOST: "${config.appUiPosthogHost ?? ""}",`,
        `  GOOGLE_ANALYTICS_ID: "${config.appUiGoogleAnalyticsId ?? ""}"`,
        "};",
        "",
      ].join("\n");
      new s3deploy.BucketDeployment(this, "AppUiDeployment", {
        destinationBucket: appBucket,
        sources: [s3deploy.Source.asset(dist, { exclude: ["config.js"] }), s3deploy.Source.data("config.js", configJs)],
        distribution,
        distributionPaths: ["/*"],
        prune: true,
        memoryLimit: 1024,
      });
    }
    if (config.deploySmdUi) {
      const dist = path.resolve(__dirname, "../../../smd-ui/dist");
      if (!fs.existsSync(path.join(dist, "index.html"))) throw new Error(`deploySmdUi is set but ${dist} has no build; run "npm ci && npm run build" in smd-ui first`);
      if (!config.chainId || !config.networkName) throw new Error("deploySmdUi needs -c chainId=... and -c networkName=...");
      const configJs = [
        "window.ENV = {",
        `  CHAIN_ID: ${config.chainId},`,
        `  NETWORK_NAME: "${config.networkName}",`,
        `  RPC_URL: "/rpc",`,
        `  EXPLORER_URL: "",`,
        `  WAGMI_PROJECT_ID: "${config.wagmiProjectId ?? ""}"`,
        "};",
        "",
      ].join("\n");
      new s3deploy.BucketDeployment(this, "SmdDeployment", {
        destinationBucket: smdBucket,
        destinationKeyPrefix: "smd/",
        sources: [s3deploy.Source.asset(dist, { exclude: ["config.js"] }), s3deploy.Source.data("config.js", configJs)],
        distribution,
        distributionPaths: ["/smd/*"],
        prune: true,
      });
    }

    new CfnOutput(this, "DistributionDomainName", { value: distribution.distributionDomainName });
    new CfnOutput(this, "DistributionId", { value: distribution.distributionId, description: "Name it in the tier map's frontend_labels variable (<id>=UIs)" });
    new CfnOutput(this, "HostnameRecord", {
      value: `${config.frontDoorDomainName} CNAME ${distribution.distributionDomainName}`,
      description: "The record to create at the registrar for the front door's hostname",
    });
  }
}
