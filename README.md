# Auto-delete of EventBridge Scheduler one-off rules

- Inspired by [this article](https://medium.com/@pubudusj/manage-eventbridge-schedules-using-step-functions-16c47d1f8428)

- Inspired by [this article](https://theburningmonk.com/2023/02/the-biggest-problem-with-eventbridge-scheduler-and-how-to-fix-it/)

## The approaches

### The approach listed in the articles from above

This one suffers from the fact that it only works with a Lambda function target. The main benefit is that it is very accurate – we will only delete the schedule when the scheduler actually invokes your target.

Keep in mind that there might be some errors between the scheduler and the target. If that is the case, [the scheduler will retry the invocation up to 185 times](https://docs.aws.amazon.com/scheduler/latest/UserGuide/getting-started.html).

### The approach with SFN and the `Wait` task

If you want to use other invocation targets than the AWS Lambda function, you will not have a way to know if the schedule was invoked or not (at least not directly). To my best knowledge, there is **no API to retrieve the "success" status of a given schedule**.

The plan here is to create the schedule via the SFN and then enter a wait state until the schedule is due. This of course has a limitation of `Wait` state maximum duration, which is one year.

When the schedule is due, you have to give the scheduler some time to invoke your target. **If you delete the schedule at this very moment, your target might not be invoked**! In the code, I've added an artificial delay of 90 seconds. This is a magic number, and feels bad to me.

Keep in mind that **this approach does not account for scheduler retries**. If the initial invocation did not succeed, and the delay time is up, the schedule will be deleted. This means that **no matter what you do, in theory, you run the risk of your target not executing**.

To be perfectly honest, I have no idea how to make this approach more robust. The ideal way would be to have some sort of event when the scheduler invokes the target. Sadly, at the time of writing this, such functionality does not exist.

### The approach with the EventBridge CRON and schedule groups

Instead of deleting a single schedule, [one can delete the whole group of schedules](https://docs.aws.amazon.com/scheduler/latest/APIReference/API_DeleteScheduleGroup.html).

> There **does not appear to be a limit to the number of schedules in a given group, but there is a limit of 500 schedule groups**. I would say that is plenty. Keep in mind that there is a limit of schedules that applies to your whole AWS account.

Instead of using SFN and the `Wait` task, we can use a CRON expression to delete the whole group after some period of time. This means you will need to _shard_ the schedules into different groups (I would recommend daily).

This solution will be **cheaper than the one with SFN, but it suffers from the same problem** – since you have no way of knowing which schedules targets were invoked successfully, you might end up deleting a schedule for a target that has not been invoked yet.

## Learnings

- If you do not specify the _schedule group_, the group name will be "default".

  - You can delete a group of schedules. There does not appear to be a limit on the number of schedules per group (?).

- The scheduler allows you to create schedules for dates that are in the past.

  - They probably forgot about the validation here, but is it even worth validating?

- **Once again, I forgot how the `iam:PassRole` works**. I should be re-hashing those mechanisms more often.

  - The `PassRole` **denotes that role A can pass role B onto a given service**.

    - The most common example is with EC2, where a user has to have `iam:PassRole` permission defined to attach a given role to the EC2 instance. Otherwise, some users with limited permissions could attach the Admin role to EC2 instance. That would be very dangerous, especially when that user could log in to that instance.

    - In **the context of EventBridge Scheduler and SFN**, the **SFN role has to have permissions to `PassRole` the Scheduler needs to perform an action when the schedule is executed**.

    - To my surprise, nobody seem to be talking about the **additional IAM conditions that one should add to the `PassRole` action**.

      - The `iam:PassedToService` is very handy here.

    - The **`iam:PassRole` action does not appear to be logged in CloudTrail**. This makes it very hard to debug.

        > PassRole is not an API call. PassRole is a permission, meaning no CloudTrail logs are generated for IAM PassRole. [Source](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_passrole.html).

      - In addition to the `iam:PassedToService` condition key, I've also tried to implement the `iam:AssociatedResourceARN` condition. I was unable to do so. I think the Scheduler does not support this condition key for the `iam:PassRole`.

        - Looking at the CloudTrail trace when the service performs the `AssumeRole` call, there is no information about the underlying resource it assumes role for. Only the ARN of the role is visible.
