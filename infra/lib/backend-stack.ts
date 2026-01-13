import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as codedeploy from "aws-cdk-lib/aws-codedeploy";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as codepipeline_actions from "aws-cdk-lib/aws-codepipeline-actions";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

export interface BackendStackProps extends cdk.StackProps {}

export class BackendStack extends cdk.Stack {
  public readonly vpc: ec2.IVpc;
  public readonly ecrRepository: ecr.Repository;
  public readonly instance: ec2.Instance;
  public readonly codeDeployApplication: codedeploy.ServerApplication;
  public readonly codeDeployDeploymentGroup: codedeploy.ServerDeploymentGroup;
  public readonly codeBuildProject: codebuild.Project;
  public readonly pipeline: codepipeline.Pipeline;

  constructor(scope: Construct, id: string, props: BackendStackProps) {
    super(scope, id, props);

    // Use default VPC
    this.vpc = ec2.Vpc.fromLookup(this, "DefaultVpc", {
      isDefault: true,
    });

    // ECR Repository for container images
    this.ecrRepository = new ecr.Repository(this, "ApiRepository", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      imageTagMutability: ecr.TagMutability.MUTABLE,
    });

    // Security Group for EC2 Instance
    const ec2SecurityGroup = new ec2.SecurityGroup(this, "Ec2SecurityGroup", {
      vpc: this.vpc,
      description: "Security group for EC2 instance",
      allowAllOutbound: true,
    });

    // Allow HTTP traffic from anywhere
    ec2SecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(3000),
      "Allow HTTP traffic on port 3000",
    );

    // Allow HTTPS traffic from anywhere (optional)
    ec2SecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "Allow HTTPS traffic",
    );

    // IAM Role for EC2 instance
    const ec2Role = new iam.Role(this, "Ec2InstanceRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMManagedInstanceCore",
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "CloudWatchAgentServerPolicy",
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonEC2RoleforAWSCodeDeploy",
        ),
      ],
    });

    // Grant ECR pull permissions to EC2 instance
    this.ecrRepository.grantPull(ec2Role);

    // Grant S3 access for CodeDeploy
    ec2Role.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["s3:GetObject", "s3:GetObjectVersion", "s3:ListBucket"],
        resources: ["*"],
      }),
    );

    // Grant SSM Parameter Store access for environment variables
    ec2Role.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath",
          "ssm:DescribeParameters",
        ],
        resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/*`],
      }),
    );

    // User data script to install Docker, Docker Compose, and CodeDeploy Agent
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      "#!/bin/bash",
      "set -e",
      "",
      "# Update system",
      "yum update -y",
      "",
      "# Install Docker",
      "yum install -y docker",
      "systemctl start docker",
      "systemctl enable docker",
      "usermod -a -G docker ec2-user",
      "",
      "# Install Docker Compose",
      'curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose',
      "chmod +x /usr/local/bin/docker-compose",
      "ln -s /usr/local/bin/docker-compose /usr/bin/docker-compose",
      "",
      "# Install CodeDeploy Agent",
      "yum install -y ruby wget",
      "cd /home/ec2-user",
      `wget https://aws-codedeploy-${this.region}.s3.${this.region}.amazonaws.com/latest/install`,
      "chmod +x ./install",
      "./install auto",
      "systemctl start codedeploy-agent",
      "systemctl enable codedeploy-agent",
      "",
      "# Create application directory",
      "mkdir -p /var/app/current",
      "mkdir -p /var/app/previous",
      "chown -R ec2-user:ec2-user /var/app",
    );

    // Single EC2 Instance
    this.instance = new ec2.Instance(this, "ApiInstance", {
      vpc: this.vpc,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO,
      ),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      role: ec2Role,
      securityGroup: ec2SecurityGroup,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      userData: userData,
      // Assign public IP for direct access
      associatePublicIpAddress: true,
    });

    // Create SSM Parameters for application environment variables
    const appName = "ec2-codepipeline-build-deploy";
    const envName = "prod";

    // Deployment version parameter
    new ssm.StringParameter(this, "ApiDeploymentVersion", {
      parameterName: `/${appName}/${envName}/DEPLOYMENT_VERSION`,
      stringValue: "1.0.0",
      description: "Current deployment version of the API",
      tier: ssm.ParameterTier.STANDARD,
    });

    // Feature flag parameter
    new ssm.StringParameter(this, "ApiFeatureFlag", {
      parameterName: `/${appName}/${envName}/FEATURE_HEALTH_DETAILS`,
      stringValue: "enabled",
      description: "Feature flag to show detailed health information",
      tier: ssm.ParameterTier.STANDARD,
    });

    // CodeBuild Project for building Docker images
    this.codeBuildProject = new codebuild.PipelineProject(
      this,
      "ApiCodeBuildProject",
      {
        buildSpec: codebuild.BuildSpec.fromSourceFilename(
          "apps/api/buildspec.yml",
        ),
        environment: {
          buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
          privileged: true, // Required for Docker builds
          computeType: codebuild.ComputeType.SMALL,
        },
        environmentVariables: {
          AWS_DEFAULT_REGION: { value: this.region },
          AWS_ACCOUNT_ID: { value: this.account },
          IMAGE_REPO_NAME: { value: this.ecrRepository.repositoryName },
          IMAGE_TAG: { value: "latest" },
        },
      },
    );

    // Grant ECR permissions to CodeBuild
    this.ecrRepository.grantPullPush(this.codeBuildProject);

    // CodeDeploy Application for in-place deployments
    this.codeDeployApplication = new codedeploy.ServerApplication(
      this,
      "ApiCodeDeployApplication",
    );

    // CodeDeploy Deployment Group for in-place deployments
    this.codeDeployDeploymentGroup = new codedeploy.ServerDeploymentGroup(
      this,
      "ApiDeploymentGroup",
      {
        application: this.codeDeployApplication,
        ec2InstanceTags: new codedeploy.InstanceTagSet({
          Application: ["ec2-codepipeline-build-deploy"],
          Environment: ["prod"],
        }),
        installAgent: false, // We installed it manually in user data
        deploymentConfig: codedeploy.ServerDeploymentConfig.ALL_AT_ONCE,
      },
    );

    // Add custom tags to instance for CodeDeploy targeting
    cdk.Tags.of(this.instance).add("Application", "ec2-codepipeline-build-deploy");
    cdk.Tags.of(this.instance).add("Environment", "prod");

    // CodePipeline Setup
    // S3 bucket for pipeline artifacts
    const artifactBucket = new s3.Bucket(this, "ApiPipelineArtifacts", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // Source output artifact
    const sourceOutput = new codepipeline.Artifact("SourceOutput");

    // Build output artifact
    const buildOutput = new codepipeline.Artifact("BuildOutput");

    // CodePipeline - Auto-triggered from GitHub with manual approval gate
    this.pipeline = new codepipeline.Pipeline(this, "ApiPipeline", {
      artifactBucket,
    });

    // Stage 1: Source from GitHub via CodeStar Connection
    const sourceAction =
      new codepipeline_actions.CodeStarConnectionsSourceAction({
        actionName: "GitHub_Source",
        owner: "Armadillidiid",
        repo: "ec2-codepipeline-build-deploy",
        branch: "main",
        output: sourceOutput,
        connectionArn:
          "arn:aws:codeconnections:eu-west-2:699475931797:connection/e5264c20-3888-4e2e-8df0-d22a5f091c32",
      });

    this.pipeline.addStage({
      stageName: "Source",
      actions: [sourceAction],
    });

    // Stage 2: Build with CodeBuild
    this.pipeline.addStage({
      stageName: "Build",
      actions: [
        new codepipeline_actions.CodeBuildAction({
          actionName: "Build_Docker_Image",
          project: this.codeBuildProject,
          input: sourceOutput,
          outputs: [buildOutput],
        }),
      ],
    });

    // Stage 3: Deploy with CodeDeploy to EC2
    this.pipeline.addStage({
      stageName: "Deploy",
      actions: [
        new codepipeline_actions.CodeDeployServerDeployAction({
          actionName: "Deploy_to_EC2",
          deploymentGroup: this.codeDeployDeploymentGroup,
          input: buildOutput,
        }),
      ],
    });

    // Outputs
    new cdk.CfnOutput(this, "InstancePublicIP", {
      value: this.instance.instancePublicIp,
      description: "Public IP of the EC2 instance",
      exportName: "InstancePublicIP",
    });

    new cdk.CfnOutput(this, "InstanceId", {
      value: this.instance.instanceId,
      description: "EC2 Instance ID",
      exportName: "InstanceId",
    });

    new cdk.CfnOutput(this, "ApiUrl", {
      value: `http://${this.instance.instancePublicIp}:3000`,
      description: "API URL (access your app here)",
      exportName: "ApiUrl",
    });

    new cdk.CfnOutput(this, "ECRRepositoryURI", {
      value: this.ecrRepository.repositoryUri,
      description: "ECR Repository URI",
      exportName: "ECRRepositoryURI",
    });

    new cdk.CfnOutput(this, "CodeBuildProjectName", {
      value: this.codeBuildProject.projectName,
      description: "CodeBuild Project Name",
      exportName: "CodeBuildProjectName",
    });

    new cdk.CfnOutput(this, "CodeDeployApplicationName", {
      value: this.codeDeployApplication.applicationName,
      description: "CodeDeploy Application Name",
      exportName: "CodeDeployApplicationName",
    });

    new cdk.CfnOutput(this, "CodeDeployDeploymentGroupName", {
      value: this.codeDeployDeploymentGroup.deploymentGroupName,
      description: "CodeDeploy Deployment Group Name",
      exportName: "CodeDeployDeploymentGroupName",
    });

    new cdk.CfnOutput(this, "PipelineName", {
      value: this.pipeline.pipelineName,
      description: "API CodePipeline Name",
      exportName: "ApiPipelineName",
    });

    new cdk.CfnOutput(this, "PipelineArn", {
      value: this.pipeline.pipelineArn,
      description: "API CodePipeline ARN",
      exportName: "ApiPipelineArn",
    });
  }
}
