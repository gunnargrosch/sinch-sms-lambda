import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { SinchClient } from "@sinch/sdk-core";
import { SQSEvent, SQSBatchResponse, EventBridgeEvent, SNSEvent } from "aws-lambda";

const ssm = new SSMClient({});
const SINCH_REGION = process.env.SINCH_REGION || "us";
const SINCH_PROJECT_ID = process.env.SINCH_PROJECT_ID!;
const SINCH_APP_ID = process.env.SINCH_APP_ID!;
const SINCH_SMS_SENDER = process.env.SINCH_SMS_SENDER!;
const SINCH_ACCESS_KEY_PARAM = process.env.SINCH_ACCESS_KEY_PARAM!;
const SINCH_ACCESS_KEY_SECRET_PARAM = process.env.SINCH_ACCESS_KEY_SECRET_PARAM!;

let sinchClient: SinchClient | null = null;

async function getClient(): Promise<SinchClient> {
  if (sinchClient) return sinchClient;
  const [keyRes, secretRes] = await Promise.all([
    ssm.send(new GetParameterCommand({ Name: SINCH_ACCESS_KEY_PARAM, WithDecryption: true })),
    ssm.send(new GetParameterCommand({ Name: SINCH_ACCESS_KEY_SECRET_PARAM, WithDecryption: true })),
  ]);
  sinchClient = new SinchClient({
    projectId: SINCH_PROJECT_ID,
    keyId: keyRes.Parameter!.Value!,
    keySecret: secretRes.Parameter!.Value!,
    conversationRegion: SINCH_REGION as "us" | "eu",
  });
  return sinchClient;
}

const E164_REGEX = /^\+[1-9]\d{1,14}$/;

async function sendSms(to: string, message: string) {
  if (!E164_REGEX.test(to)) {
    throw new Error(`Invalid phone number format. Use E.164 (e.g. +15551234567), got: ${to}`);
  }
  const client = await getClient();
  return client.conversation.messages.send({
    sendMessageRequestBody: {
      app_id: SINCH_APP_ID,
      recipient: { identified_by: { channel_identities: [{ channel: "SMS", identity: to }] } },
      message: { text_message: { text: message } },
      channel_properties: { SMS_SENDER: SINCH_SMS_SENDER },
    },
  });
}

// --- Direct invocation (default) ---
export const handler = async (event: { to: string; message: string }) => {
  if (!event.to || !event.message) return { statusCode: 400, body: "Missing to or message" };
  try {
    return { statusCode: 200, body: await sendSms(event.to, event.message) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: String(err) };
  }
};

// --- SQS (uncomment to use) ---
// Message body format: { "to": "+15551234567", "message": "Hello!" }
// Returns batchItemFailures so only failed records are retried, preventing duplicate sends.
//
// export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
//   const failures: { itemIdentifier: string }[] = [];
//   for (const record of event.Records) {
//     try {
//       const payload = JSON.parse(record.body);
//       await sendSms(payload.to, payload.message);
//     } catch (err) {
//       console.error(`Failed record ${record.messageId}:`, err);
//       failures.push({ itemIdentifier: record.messageId });
//     }
//   }
//   return { batchItemFailures: failures };
// };

// --- EventBridge (uncomment to use) ---
// Event detail format: { "to": "+15551234567", "message": "Hello!" }
//
// export const handler = async (
//   event: EventBridgeEvent<"SendSms", { to: string; message: string }>
// ) => {
//   await sendSms(event.detail.to, event.detail.message);
// };

// --- SNS (uncomment to use) ---
// SNS message body format: { "to": "+15551234567", "message": "Hello!" }
//
// export const handler = async (event: SNSEvent) => {
//   for (const record of event.Records) {
//     const payload = JSON.parse(record.Sns.Message);
//     await sendSms(payload.to, payload.message);
//   }
// };
