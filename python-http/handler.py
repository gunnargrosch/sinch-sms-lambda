import json
import os
import re
import time
import urllib.request
import urllib.error
from base64 import b64encode
import boto3

ssm = boto3.client("ssm")

SINCH_REGION = os.environ.get("SINCH_REGION", "us")
SINCH_PROJECT_ID = os.environ["SINCH_PROJECT_ID"]
SINCH_APP_ID = os.environ["SINCH_APP_ID"]
SINCH_SMS_SENDER = os.environ["SINCH_SMS_SENDER"]
SINCH_ACCESS_KEY_PARAM = os.environ["SINCH_ACCESS_KEY_PARAM"]
SINCH_ACCESS_KEY_SECRET_PARAM = os.environ["SINCH_ACCESS_KEY_SECRET_PARAM"]

E164_REGEX = re.compile(r"^\+[1-9]\d{1,14}$")

# Module-level cache — shared across warm invocations regardless of trigger type
_credentials = None
_token_cache = {"value": None, "expires_at": 0}


def get_credentials():
    global _credentials
    if _credentials:
        return _credentials
    key = ssm.get_parameter(Name=SINCH_ACCESS_KEY_PARAM, WithDecryption=True)["Parameter"]["Value"]
    secret = ssm.get_parameter(Name=SINCH_ACCESS_KEY_SECRET_PARAM, WithDecryption=True)["Parameter"]["Value"]
    _credentials = (key, secret)
    return _credentials


def get_access_token():
    now = time.time()
    if _token_cache["value"] and now < _token_cache["expires_at"]:
        return _token_cache["value"]

    access_key, access_key_secret = get_credentials()
    encoded = b64encode(f"{access_key}:{access_key_secret}".encode()).decode()

    req = urllib.request.Request(
        "https://auth.sinch.com/oauth2/token",
        data=b"grant_type=client_credentials",
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": f"Basic {encoded}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Token request failed {e.code}: {e.read().decode()}")

    _token_cache["value"] = data["access_token"]
    _token_cache["expires_at"] = now + data["expires_in"] - 60
    return _token_cache["value"]


def send_sms(to, message):
    if not E164_REGEX.match(to):
        raise ValueError(f"Invalid phone number format. Use E.164 (e.g. +15551234567), got: {to}")

    token = get_access_token()
    payload = json.dumps({
        "app_id": SINCH_APP_ID,
        "recipient": {"identified_by": {"channel_identities": [{"channel": "SMS", "identity": to}]}},
        "message": {"text_message": {"text": message}},
        "channel_properties": {"SMS_SENDER": SINCH_SMS_SENDER},
    }).encode()

    url = f"https://{SINCH_REGION}.conversation.api.sinch.com/v1/projects/{SINCH_PROJECT_ID}/messages:send"
    req = urllib.request.Request(
        url, data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as e:
        error = e.read().decode()
        print(f"Sinch API error: {error}")
        raise RuntimeError(f"Sinch API error {e.code}: {error}")


# --- Direct invocation (default) ---
def handler(event, context):
    to = event.get("to")
    message = event.get("message")
    if not to or not message:
        return {"statusCode": 400, "body": "Missing to or message"}
    try:
        return {"statusCode": 200, "body": send_sms(to, message)}
    except Exception as e:
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