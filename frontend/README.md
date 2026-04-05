# CoverageAtlas Frontend

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start dev server:
```bash
npm run dev
```

3. Build for production:
```bash
npm run build
```

## Runtime Notes

- Frontend calls backend REST APIs from `frontend/src/api/client.ts`.
- Voice page currently uses the backend voice-session endpoints:
  - `POST /api/v1/voice/session/start`
  - `POST /api/v1/voice/session/{session_id}/turn`
  - `POST /api/v1/voice/session/{session_id}/end`
