import json
import os
import re
import boto3
from sinch import SinchClient
from sinch.core.exceptions import SinchException

ssm = boto3.client("ssm")

SINCH_REGION = os.environ.get("SINCH_REGION", "us")
SINCH_PROJECT_ID = os.environ["SINCH_PROJECT_ID"]
SINCH_APP_ID = os.environ["SINCH_APP_ID"]
SINCH_SMS_SENDER = os.environ["SINCH_SMS_SENDER"]
SINCH_ACCESS_KEY_PARAM = os.environ["SINCH_ACCESS_KEY_PARAM"]
SINCH_ACCESS_KEY_SECRET_PARAM = os.environ["SINCH_ACCESS_KEY_SECRET_PARAM"]

E164_REGEX = re.compile(r"^\+[1-9]\d{1,14}$")

_sinch_client = None


def get_client():
    global _sinch_client
    if _sinch_client:
        return _sinch_client
    key = ssm.get_parameter(Name=SINCH_ACCESS_KEY_PARAM, WithDecryption=True)["Parameter"]["Value"]
    secret = ssm.get_parameter(Name=SINCH_ACCESS_KEY_SECRET_PARAM, WithDecryption=True)["Parameter"]["Value"]
    _sinch_client = SinchClient(
        project_id=SINCH_PROJECT_ID,
        key_id=key,
        key_secret=secret,
        conversation_region=SINCH_REGION,
    )
    return _sinch_client


def send_sms(to, message):
    if not E164_REGEX.match(to):
        raise ValueError(f"Invalid phone number format. Use E.164 (e.g. +15551234567), got: {to}")
    client = get_client()
    return client.conversation.messages.send_text_message(
        app_id=SINCH_APP_ID,
        text=message,
        recipient_identities=[{"channel": "SMS", "identity": to}],
        channel_properties={"SMS_SENDER": SINCH_SMS_SENDER},
    )


# --- Direct invocation (default) ---
def handler(event, context):
    to = event.get("to")
    message = event.get("message")
    if not to or not message:
        return {"statusCode": 400, "body": "Missing to or message"}
    try:
        result = send_sms(to, message)
        return {"statusCode": 200, "body": {"message_id": result.message_id, "accepted_time": str(result.accepted_time)}}
    except Exception as e:
        if isinstance(e, SinchException):
            print(f"Sinch API error {e.response_status_code}: {e}")
            return {"statusCode": e.response_status_code or 500, "body": str(e)}
        print(f"Error: {e}")
        return {"statusCode": 500, "body": str(e)}


# --- SQS (uncomment to use) ---
# Message body format: {"to": "+15551234567", "message": "Hello!"}
# Returns batchItemFailures so only failed records are retried, preventing duplicate sends.
#
# def handler(event, context):
#     failures = []
#     for record in event["Records"]:
#         try:
#             payload = json.loads(record["body"])
#             send_sms(payload["to"], payload["message"])
#         except Exception as e:
#             print(f"Failed record {record['messageId']}: {e}")
#             failures.append({"itemIdentifier": record["messageId"]})
#     return {"batchItemFailures": failures}


# --- EventBridge (uncomment to use) ---
# Event detail format: {"to": "+15551234567", "message": "Hello!"}
#
# def handler(event, context):
#     detail = event["detail"]
#     send_sms(detail["to"], detail["message"])


# --- SNS (uncomment to use) ---
# SNS message body format: {"to": "+15551234567", "message": "Hello!"}
#
# def handler(event, context):
#     for record in event["Records"]:
#         payload = json.loads(record["Sns"]["Message"])
#         send_sms(payload["to"], payload["message"])