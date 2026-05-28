import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { SQSEvent, SQSBatchResponse, EventBridgeEvent, SNSEvent } from "aws-lambda";

const ssm = new SSMClient({});
const SINCH_REGION = process.env.SINCH_REGION || "us";
const SINCH_PROJECT_ID = process.env.SINCH_PROJECT_ID!;
const SINCH_APP_ID = process.env.SINCH_APP_ID!;
const SINCH_SMS_SENDER = process.env.SINCH_SMS_SENDER!;
const SINCH_ACCESS_KEY_PARAM = process.env.SINCH_ACCESS_KEY_PARAM!;
const SINCH_ACCESS_KEY_SECRET_PARAM = process.env.SINCH_ACCESS_KEY_SECRET_PARAM!;

// Cached at module level. Reused across warm invocations regardless of trigger type
let credentials: { accessKey: string; accessKeySecret: string } | null = null;
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getCredentials() {
  if (credentials) return credentials;
  const [keyRes, secretRes] = await Promise.all([
    ssm.send(new GetParameterCommand({ Name: SINCH_ACCESS_KEY_PARAM, WithDecryption: true })),
    ssm.send(new GetParameterCommand({ Name: SINCH_ACCESS_KEY_SECRET_PARAM, WithDecryption: true })),
  ]);
  credentials = {
    accessKey: keyRes.Parameter!.Value!,
    accessKeySecret: secretRes.Parameter!.Value!,
  };
  return credentials;
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < cachedToken.expiresAt) return cachedToken.value; // Refreshes automatically when expired

  const { accessKey, accessKeySecret } = await getCredentials();
  const encoded = Buffer.from(`${accessKey}:${accessKeySecret}`).toString("base64");

  // Exchange credentials for a short-lived OAuth 2.0 Bearer token (valid ~1 hour).
  // Basic auth is rate-limited and for testing only. Don't use it directly on the Sinch API.
  const response = await fetch("https://auth.sinch.com/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${encoded}`,
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) throw new Error(`Token request failed: ${await response.text()}`);

  const data = await response.json() as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: now + (data.expires_in - 60) * 1000 };
  return cachedToken.value;
}

const E164_REGEX = /^\+[1-9]\d{1,14}$/;

async function sendSms(to: string, message: string) {
  if (!E164_REGEX.test(to)) {
    throw new Error(`Invalid phone number format. Use E.164 (e.g. +15551234567), got: ${to}`);
  }

  const token = await getAccessToken();

  const response = await fetch(
    `https://${SINCH_REGION}.conversation.api.sinch.com/v1/projects/${SINCH_PROJECT_ID}/messages:send`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        app_id: SINCH_APP_ID,
        recipient: { identified_by: { channel_identities: [{ channel: "SMS", identity: to }] } },
        message: { text_message: { text: message } },
        channel_properties: { SMS_SENDER: SINCH_SMS_SENDER },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Sinch API error ${response.status}: ${error}`);
  }

  return response.json();
}

// --- Direct invocation (default) ---
export const handler = async (event: { to: string; message: string }) => {
  if (!event.to || !event.message) {
    return { statusCode: 400, body: "Missing to or message" };
  }
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
