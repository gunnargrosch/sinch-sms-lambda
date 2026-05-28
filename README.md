# sinch-sms-lambda

Send SMS from AWS Lambda using the [Sinch Conversation API](https://developers.sinch.com/docs/conversation/). Four parallel implementations in TypeScript and Python, with and without the Sinch SDK. Credentials are stored in SSM Parameter Store. The handler can be wired to direct invocation, SQS, EventBridge, SNS, or API Gateway.

## Examples

| Directory | Language | Approach |
|---|---|---|
| `node-http/` | TypeScript | Raw HTTP, no SDK |
| `node-sdk/` | TypeScript | [@sinch/sdk-core](https://www.npmjs.com/package/@sinch/sdk-core) |
| `python-http/` | Python | Raw HTTP, stdlib only |
| `python-sdk/` | Python | [sinch](https://pypi.org/project/sinch/) SDK |

All four deploy from a single `template.yaml` at the repo root.

## Prerequisites

- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
- Node.js 22+ (for node examples) or Python 3.13+ (for python examples)
- A Sinch account ([sign up here](https://dashboard.sinch.com/signup))

## Setup

### 1. Configure Sinch

You need the following from the [Sinch Build Dashboard](https://dashboard.sinch.com):

- **Project ID:** top bar, click the project name, then Project Settings
- **App ID:** Conversation API > Apps (the SMS Onboarding app is created automatically on signup)
- **SMS sender number:** SMS > SMS Channel > Numbers tab
- **Access key ID and secret:** Settings > Access Keys (secret shown once at creation)
- **Region:** `us` or `eu`, must match your SMS service plan region

### 2. Store credentials in SSM Parameter Store

Run these in the same AWS region where you'll deploy the Lambda:

```bash
aws ssm put-parameter \
  --name /sinch/access-key \
  --value "YOUR_ACCESS_KEY" \
  --type SecureString

aws ssm put-parameter \
  --name /sinch/access-key-secret \
  --value "YOUR_ACCESS_KEY_SECRET" \
  --type SecureString
```

### 3. Deploy

```bash
sam build
sam deploy --guided
```

You'll be prompted for `SinchRegion`, `SinchProjectId`, `SinchAppId`, `SinchSmsSender`, and the SSM parameter paths (defaults to `/sinch/access-key` and `/sinch/access-key-secret`).

After deploying, get the function names from the stack outputs:

```bash
aws cloudformation describe-stacks \
  --stack-name sinch-sms-lambda \
  --query "Stacks[0].Outputs"
```

## Invoking a function

```bash
aws lambda invoke \
  --function-name <NodeHttpFunctionName from outputs> \
  --payload '{"to": "+15559876543", "message": "Hello from Lambda!"}' \
  --cli-binary-format raw-in-base64-out \
  response.json

cat response.json
```

Replace the function name with `NodeSdkFunctionName`, `PythonHttpFunctionName`, or `PythonSdkFunctionName` to test the other examples.

## Wiring up an event source

Each handler has a `sendSms(to, message)` function and a thin event adapter as the exported `handler`. To use a different trigger, uncomment the relevant handler variant and the matching `Events:` block in `template.yaml` (commented on `NodeHttpFunction`).

All examples use `to` and `message` as field names. Adapt to match your event schema.

### SQS

```json
{ "to": "+15551234567", "message": "Your order has shipped." }
```

### EventBridge

```json
{
  "source": "myapp.orders",
  "detail-type": "OrderShipped",
  "detail": { "to": "+15551234567", "message": "Your order has shipped." }
}
```

### SNS

```json
{ "to": "+15551234567", "message": "Verification code: 847291" }
```

## Resources

- [Sinch Conversation API](https://developers.sinch.com/docs/conversation/)
- [SMS channel setup](https://developers.sinch.com/docs/conversation/channel-support/sms/set-up)
- [Sinch Node.js SDK](https://developers.sinch.com/docs/sdks/node/)
- [Sinch Python SDK](https://developers.sinch.com/docs/sdks/python/)
- [Sinch Java SDK](https://developers.sinch.com/docs/sdks/java/)
- [Sinch .NET SDK](https://developers.sinch.com/docs/sdks/dotnet/)
