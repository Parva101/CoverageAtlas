# LiveKit Playground Testing

Set these env vars before running commands:

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`

## 1) Ensure a test room exists

```powershell
python backend/livekit/playground_tools.py ensure-room --room policy-playground-room
```

## 2) Generate a token for LiveKit Meet / playground

```powershell
python backend/livekit/playground_tools.py create-token --room policy-playground-room --name "Test User"
```

This prints:

- `LIVEKIT_URL`
- `ROOM`
- `IDENTITY`
- token between `TOKEN_START` and `TOKEN_END`

## 3) List rooms

```powershell
python backend/livekit/playground_tools.py list-rooms
```

## 4) Delete a room

```powershell
python backend/livekit/playground_tools.py delete-room --room policy-playground-room
```

## 5) Twilio inbound setup (LiveKit side)

Use this once per Twilio number to ensure:

- an inbound SIP trunk exists in LiveKit for that number
- a direct SIP dispatch rule exists to your room
- room config dispatches your `Policy_Agent`

```powershell
python backend/livekit/playground_tools.py setup-twilio-inbound --phone-number +19494710108 --room policy-playground-room --agent-name Policy_Agent
```

Check current SIP resources:

```powershell
python backend/livekit/playground_tools.py list-sip
```

Twilio console still needs routing configured:

- Elastic SIP Trunking origination URI must point to your LiveKit SIP URI with `;transport=tcp`.
- Associate your Twilio phone number with the Twilio SIP trunk.

## Notes

- Room creation is optional in LiveKit because rooms auto-create on first join.
- `create-token` includes agent dispatch by default using `AGENT_NAME` (fallback: `Policy_Agent`).
