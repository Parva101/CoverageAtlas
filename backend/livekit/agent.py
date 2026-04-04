import asyncio
import logging
import os
from dataclasses import dataclass
from typing import Optional
from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentSession,
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    WorkerType,
    cli,
)
from livekit.plugins import elevenlabs, google
load_dotenv("D:\\projects\\github_projects\\innovation_hacks\\.env", override=True)
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
logger = logging.getLogger("policy_voice_agent")


@dataclass
class SessionState:
    participant_identity: str = "unknown"


class PolicyAgent(Agent):
    def __init__(self) -> None:
        super().__init__(
            instructions=(
                "You are a helpful voice assistant for U.S. medical benefit drug policy questions. "
                "Use plain language and short answers. "
                "Explain prior authorization, step therapy, coverage limits, and clinical criteria when users ask. "
                "If plan-specific facts are missing, say what details are needed and do not guess."
            )
        )

    async def on_enter(self) -> None:
        self.session.generate_reply(
            instructions=(
                "Greet the user and say: "
                "Hi, I can help you understand medical benefit drug policies. "
                "Tell me the drug name and health plan you want to check."
            ),
            allow_interruptions=True,
        )


async def entrypoint(ctx: JobContext) -> None:
    session: Optional[AgentSession] = None

    try:
        await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
        participant = await ctx.wait_for_participant()

        state = SessionState(participant_identity=participant.identity or "unknown")

        realtime_model_kwargs = {
            "voice": os.environ.get("GOOGLE_REALTIME_VOICE", "Puck"),
            "model": os.environ.get("GOOGLE_REALTIME_MODEL", "gemini-live-2.5-flash-native-audio"),
            "temperature": float(os.environ.get("GOOGLE_REALTIME_TEMPERATURE", "0.8")),
        }

        use_vertexai = os.environ.get("GOOGLE_REALTIME_VERTEXAI", "1").lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
        realtime_model_kwargs["vertexai"] = use_vertexai

        google_cloud_project = os.environ.get("GOOGLE_CLOUD_PROJECT", "").strip()
        if google_cloud_project:
            realtime_model_kwargs["project"] = google_cloud_project

        google_cloud_location = os.environ.get("GOOGLE_CLOUD_LOCATION", "").strip()
        if google_cloud_location:
            realtime_model_kwargs["location"] = google_cloud_location

        session = AgentSession(
            userdata=state,
            llm=google.realtime.RealtimeModel(**realtime_model_kwargs),
           # tts=elevenlabs.TTS(),
        )

        await session.start(agent=PolicyAgent(), room=ctx.room)

        caller_disconnected = asyncio.Event()

        @ctx.room.on("participant_disconnected")
        def on_participant_disconnected(disconnected_participant) -> None:
            if disconnected_participant.identity == state.participant_identity:
                caller_disconnected.set()

        if not any(
            remote_participant.identity == state.participant_identity
            for remote_participant in ctx.room.remote_participants.values()
        ):
            caller_disconnected.set()

        await caller_disconnected.wait()

    except Exception:
        logger.exception("Policy agent failed")
        raise
    finally:
        if session:
            await session.aclose()


if __name__ == "__main__":
    opts = WorkerOptions(
        entrypoint_fnc=entrypoint,
        worker_type=WorkerType.ROOM,
        agent_name=os.environ.get("AGENT_NAME", "Policy_Agent"),
        initialize_process_timeout=60,
    )
    cli.run_app(opts)
