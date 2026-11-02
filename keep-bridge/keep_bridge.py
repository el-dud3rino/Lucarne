#!/usr/bin/env python3
"""Lucarne <-> Google Keep bridge.

A small stateless CLI that Lucarne's server runs for each sync. It reads one JSON
request on stdin and writes one JSON response on stdout. All merge logic lives in
Lucarne (TypeScript); this script only reads Keep lists and applies changes.

Uses the UNOFFICIAL gkeepapi library (the official Keep API is Workspace-only),
so every failure is reported as structured JSON instead of crashing Lucarne.

Commands (argv[1]):
  notes  -> {"ok": true, "notes": [{"id", "title", "itemCount"}]}
  read   stdin {"noteIds": [...]}
         -> {"ok": true, "notes": {noteId: {"title", "items": [{"id","text","checked"}]} | null}}
  apply  stdin {"noteId": "...", "ops": [{"op":"create","tempId","text","checked"} |
                                          {"op":"update","keepId","text","checked"} |
                                          {"op":"delete","keepId"}]}
         -> {"ok": true, "created": {tempId: keepId}}
  create_list stdin {"title": "..."} -> {"ok": true, "note": {"id", "title", "itemCount": 0}}
Errors   -> {"ok": false, "error": "<kind>", "message": "..."} with exit code 1.
"""
import json
import os
import pathlib
import sys


def data_dir() -> pathlib.Path:
    return pathlib.Path(os.environ.get("DATA_DIR", "./data")).resolve() / "keep"


def respond(obj: dict, code: int = 0) -> None:
    sys.stdout.write(json.dumps(obj))
    sys.stdout.flush()
    sys.exit(code)


def fail(kind: str, message: str) -> None:
    respond({"ok": False, "error": kind, "message": message}, 1)


def load_keep():
    try:
        import gkeepapi
    except ImportError:
        fail("missing_dependency", "gkeepapi is not installed. Run: npm run keep:setup")

    folder = data_dir()
    cred_path = folder / "credentials.json"
    if not cred_path.exists():
        fail("not_configured", "Google Keep is not linked yet. Run: npm run keep:login")
    creds = json.loads(cred_path.read_text(encoding="utf-8"))

    state_path = folder / "state.json"
    state = None
    if state_path.exists():
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except Exception:
            state = None

    def connect(cached_state):
        keep = gkeepapi.Keep()
        keep.authenticate(
            creds["email"],
            creds["masterToken"],
            state=cached_state,
            sync=True,
            device_id=creds.get("deviceId"),
        )
        return keep

    try:
        keep = connect(state)
    except gkeepapi.exception.LoginException as e:
        fail("auth", f"Google rejected the Keep login ({e}). Re-run: npm run keep:login")
    except Exception as first_error:
        if state is None:
            fail("sync", f"Keep sync failed: {first_error}")
        # Cached state may be stale or corrupt; retry once with a full resync.
        try:
            keep = connect(None)
        except gkeepapi.exception.LoginException as e:
            fail("auth", f"Google rejected the Keep login ({e}). Re-run: npm run keep:login")
        except Exception as e:
            fail("sync", f"Keep sync failed: {e}")
    return keep, state_path


def save_state(keep, state_path: pathlib.Path) -> None:
    tmp = state_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(keep.dump()), encoding="utf-8")
    os.replace(tmp, state_path)


def is_live(node) -> bool:
    return not (node.deleted or node.trashed)


def find_list(keep, note_id: str):
    import gkeepapi

    note = keep.get(note_id)
    if note is None or not isinstance(note, gkeepapi.node.List) or not is_live(note):
        return None
    return note


def item_json(item) -> dict:
    return {"id": item.id, "text": item.text, "checked": bool(item.checked)}


def cmd_notes(keep) -> dict:
    import gkeepapi

    notes = [
        {"id": n.id, "title": n.title or "(untitled list)", "itemCount": len(n.items)}
        for n in keep.all()
        if isinstance(n, gkeepapi.node.List) and is_live(n) and not n.archived
    ]
    notes.sort(key=lambda n: n["title"].lower())
    return {"ok": True, "notes": notes}


def cmd_read(keep, req: dict) -> dict:
    result = {}
    for note_id in req.get("noteIds", []):
        note = find_list(keep, note_id)
        result[note_id] = (
            None
            if note is None
            else {"title": note.title, "items": [item_json(i) for i in note.items]}
        )
    return {"ok": True, "notes": result}


def cmd_apply(keep, req: dict) -> dict:
    note = find_list(keep, req["noteId"])
    if note is None:
        fail("note_missing", "The linked Keep list no longer exists (deleted or trashed).")

    by_id = {i.id: i for i in note.items}
    created = {}
    for op in req.get("ops", []):
        kind = op.get("op")
        if kind == "create":
            item = note.add(op["text"], bool(op.get("checked", False)))
            created[op["tempId"]] = item.id
        elif kind == "update":
            item = by_id.get(op["keepId"])
            if item is None:
                continue
            if item.text != op["text"]:
                item.text = op["text"]
            if bool(item.checked) != bool(op["checked"]):
                item.checked = bool(op["checked"])
        elif kind == "delete":
            item = by_id.get(op["keepId"])
            if item is not None:
                item.delete()
    keep.sync()
    return {"ok": True, "created": created}


def cmd_create_list(keep, req: dict) -> dict:
    title = (req.get("title") or "").strip() or "Lucarne list"
    note = keep.createList(title, [])
    keep.sync()
    return {"ok": True, "note": {"id": note.id, "title": note.title, "itemCount": 0}}


COMMANDS = ("notes", "read", "apply", "create_list")


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        fail("usage", "usage: keep_bridge.py " + "|".join(COMMANDS))
    command = sys.argv[1]
    req = {}
    if command != "notes":
        raw = sys.stdin.read()
        req = json.loads(raw) if raw.strip() else {}

    keep, state_path = load_keep()
    try:
        if command == "notes":
            out = cmd_notes(keep)
        elif command == "read":
            out = cmd_read(keep, req)
        elif command == "create_list":
            out = cmd_create_list(keep, req)
        else:
            out = cmd_apply(keep, req)
    except SystemExit:
        raise
    except Exception as e:
        fail("sync", f"Keep {command} failed: {e}")

    try:
        save_state(keep, state_path)
    except Exception:
        pass  # cache only; next run does a full sync
    respond(out)


if __name__ == "__main__":
    main()
