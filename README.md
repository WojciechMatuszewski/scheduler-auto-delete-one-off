# Auto-delete of EventBridge Scheduler one-off rules

- Inspired by [this article](https://medium.com/@pubudusj/manage-eventbridge-schedules-using-step-functions-16c47d1f8428)

- Inspired by [this article](https://theburningmonk.com/2023/02/the-biggest-problem-with-eventbridge-scheduler-and-how-to-fix-it/)

## The architecture

WIP

## Learnings

- If you do not specify the _schedule group_, the group name will be "default".

  - TODO: Check how the deletion of the whole group works.

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
