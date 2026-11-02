#!/usr/bin/env python3
"""One-time Google Keep link for Lucarne.

Run this yourself in a terminal (it asks for a secret token, so don't run it inside an AI chat):

    npm run keep:login

How to get the one-time oauth_token it asks for:
  1. In a desktop browser, open https://accounts.google.com/EmbeddedSetup
     and sign in with the Google account that owns your Keep shopping list.
  2. Click "I agree" (the page may then spin forever; that is expected).
  3. Open DevTools (F12) -> Application -> Cookies -> https://accounts.google.com
  4. Copy the value of the cookie named  oauth_token  (starts with "oauth2_4/").
     It is single-use and expires within minutes, so paste it here right away.

The resulting long-lived "master token" is saved to <DATA_DIR>/keep/credentials.json,
which is git-ignored. It grants broad access to that Google account: keep the device secure.
To revoke it, remove "Lucarne"/the Android device at https://myaccount.google.com/device-activity
or change the account password.
"""
import getpass
import json
import os
import pathlib
import secrets
import sys


def main() -> None:
    try:
        import gkeepapi
        import gpsoauth
    except ImportError:
        print("Dependencies missing. Run: npm run keep:setup")
        sys.exit(1)

    folder = pathlib.Path(os.environ.get("DATA_DIR", "./data")).resolve() / "keep"
    folder.mkdir(parents=True, exist_ok=True)

    print(__doc__.split("How to get")[0].strip())
    print("\nSee keep-bridge/login.py (or the README) for how to get the oauth_token.\n")
    email = input("Google account email: ").strip()
    oauth_token = getpass.getpass("oauth_token cookie value (hidden): ").strip()
    if not email or not oauth_token:
        print("Email and token are both required.")
        sys.exit(1)

    device_id = secrets.token_hex(8)
    res = gpsoauth.exchange_token(email, oauth_token, device_id)
    master_token = res.get("Token")
    if not master_token:
        print(f"Google did not return a master token: {res.get('Error', res)}")
        print("The oauth_token is single-use and short-lived; grab a fresh one and retry.")
        sys.exit(1)

    print("Got a master token. Verifying Keep access (first sync can take a little while)...")
    keep = gkeepapi.Keep()
    keep.authenticate(email, master_token, sync=True, device_id=device_id)
    lists = [n for n in keep.all() if isinstance(n, gkeepapi.node.List) and not n.trashed]

    cred_path = folder / "credentials.json"
    cred_path.write_text(
        json.dumps({"email": email, "masterToken": master_token, "deviceId": device_id}),
        encoding="utf-8",
    )
    try:
        os.chmod(cred_path, 0o600)
    except OSError:
        pass
    (folder / "state.json").write_text(json.dumps(keep.dump()), encoding="utf-8")

    print(f"\nLinked {email}. Found {len(lists)} Keep list(s):")
    for n in lists[:20]:
        print(f"  - {n.title or '(untitled list)'}")
    print("\nNow open Lucarne -> Settings -> Google Keep to choose which list to sync.")


if __name__ == "__main__":
    main()
