import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

export class EbSchedulerAutoDeleteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const machineRole = new cdk.aws_iam.Role(this, "MachineRole", {
      assumedBy: new cdk.aws_iam.ServicePrincipal("states.amazonaws.com")
    });

    const scheduleTaskTarget = new cdk.aws_lambda.Function(
      this,
      "ScheduleTaskTarget",
      {
        code: new cdk.aws_lambda.InlineCode(`
          module.exports.handler = async (event) => {
            console.log("works!");
          }
        `),
        runtime: cdk.aws_lambda.Runtime.NODEJS_18_X,
        handler: "index.handler"
      }
    );

    const invokeScheduleTargetRole = new cdk.aws_iam.Role(
      this,
      "InvokeScheduleTargetRole",
      {
        assumedBy: new cdk.aws_iam.ServicePrincipal("scheduler.amazonaws.com"),
        inlinePolicies: {
          allowInvokeTarget: new cdk.aws_iam.PolicyDocument({
            statements: [
              new cdk.aws_iam.PolicyStatement({
                actions: ["lambda:InvokeFunction"],
                resources: [scheduleTaskTarget.functionArn]
              })
            ]
          })
        }
      }
    );

    const schedulerArn = cdk.Arn.format(
      {
        resource: "schedule/default/*",
        service: "scheduler"
      },
      this
    );
    /**
     * Allow the scheduler to use the `invokeScheduleTargetRole` to invoke the `scheduleTaskTarget`.
     * If we did not have the iam:PassRole, an attacker might attach an AdminPolicy with a random SFN.
     */
    machineRole.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [invokeScheduleTargetRole.roleArn],
        conditions: {
          StringEquals: {
            "iam:PassedToService": "scheduler.amazonaws.com"
          }
          /**
           * It appears not to be supported by the Scheduler.
           */
          // ArnLike: {
          //   // "iam:AssociatedResourceARN": [scheduleTaskTarget.functionArn]
          // }
        }
      })
    );

    const scheduleName = cdk.aws_stepfunctions.JsonPath.format(
      "schedule_{}",
      cdk.aws_stepfunctions.JsonPath.stringAt("$$.Execution.Name")
    );

    const createScheduleTask = new cdk.aws_stepfunctions_tasks.CallAwsService(
      this,
      "CreateSchedule",
      {
        service: "scheduler",
        action: "createSchedule",
        iamResources: [schedulerArn],
        parameters: {
          FlexibleTimeWindow: {
            Mode: "OFF"
          },
          Name: scheduleName,
          ScheduleExpression: cdk.aws_stepfunctions.JsonPath.format(
            "at({})",
            cdk.aws_stepfunctions.JsonPath.stringAt("$.timestamp")
          ),
          ScheduleExpressionTimezone: "UTC",
          Target: {
            Arn: scheduleTaskTarget.functionArn,
            RoleArn: invokeScheduleTargetRole.roleArn,
            Input: {
              scheduleName
            }
          }
        },
        resultPath: cdk.aws_stepfunctions.JsonPath.DISCARD
      }
    );

    const transformSchedulerTimestamp = new cdk.aws_stepfunctions.Pass(
      this,
      "TransformTimestamp",
      {
        parameters: {
          transformedTimestamp: cdk.aws_stepfunctions.JsonPath.format(
            "{}{}",
            cdk.aws_stepfunctions.JsonPath.stringAt("$.timestamp"),
            "Z"
          )
        }
      }
    );

    const waitForTimestamp = new cdk.aws_stepfunctions.Wait(
      this,
      "WaitForTimestamp",
      {
        time: cdk.aws_stepfunctions.WaitTime.timestampPath(
          "$.transformedTimestamp"
        )
      }
    );

    const deleteScheduleTask = new cdk.aws_stepfunctions_tasks.CallAwsService(
      this,
      "DeleteSchedule",
      {
        service: "scheduler",
        action: "deleteSchedule",
        iamResources: [schedulerArn],
        parameters: {
          Name: scheduleName
        }
      }
    );

    const machine = new cdk.aws_stepfunctions.StateMachine(this, "Machine", {
      definition: createScheduleTask
        /**
         * Race condition.
         * Since the deletion happens at the same time the schedule is executed, the schedule might never get executed.
         * Can we manipulate the date somehow? I doubt it.
         */
        .next(transformSchedulerTimestamp)
        .next(waitForTimestamp)
        .next(deleteScheduleTask),
      role: machineRole
    });
  }
}
