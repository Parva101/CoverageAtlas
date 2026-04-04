import argparse
import asyncio
import os
import re
import uuid
from datetime import timedelta
from typing import Optional

from dotenv import load_dotenv
from livekit import api

load_dotenv("D:\\projects\\github_projects\\innovation_hacks\\.env", override=True)

def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise ValueError(f"Missing required environment variable: {name}")
    return value


def _parse_ttl(ttl: str) -> timedelta:
    # Supported format examples: 30m, 1h, 24h, 2d
    match = re.fullmatch(r"(\d+)([smhd])", ttl.strip().lower())
    if not match:
        raise ValueError("Invalid ttl format. Use one of: 30m, 1h, 24h, 2d")
    amount = int(match.group(1))
    unit = match.group(2)
    if unit == "s":
        return timedelta(seconds=amount)
    if unit == "m":
        return timedelta(minutes=amount)
    if unit == "h":
        return timedelta(hours=amount)
    return timedelta(days=amount)


def _normalize_phone(number: str) -> str:
    cleaned = re.sub(r"[^\d+]", "", number.strip())
    if not cleaned:
        raise ValueError("Phone number cannot be empty.")
    if not cleaned.startswith("+"):
        cleaned = f"+{cleaned}"
    return cleaned


def _canonical_phone(number: str) -> str:
    number = _normalize_phone(number)
    return "+" + re.sub(r"\D", "", number)


def create_join_token(
    *,
    room: str,
    identity: str,
    participant_name: str,
    ttl: str,
    agent_name: Optional[str],
) -> str:
    api_key = _required_env("LIVEKIT_API_KEY")
    api_secret = _required_env("LIVEKIT_API_SECRET")

    token_builder = (
        api.AccessToken(api_key, api_secret)
        .with_identity(identity)
        .with_name(participant_name)
        .with_ttl(_parse_ttl(ttl))
        .with_grants(
            api.VideoGrants(
                room_join=True,
                room=room,
            )
        )
    )

    if agent_name:
        token_builder = token_builder.with_room_config(
            api.RoomConfiguration(
                agents=[
                    api.RoomAgentDispatch(agent_name=agent_name),
                ],
            )
        )

    return token_builder.to_jwt()


def _extract_direct_room(rule_info: api.SIPDispatchRuleInfo) -> str:
    if not rule_info.rule:
        return ""
    if not rule_info.rule.dispatch_rule_direct:
        return ""
    return rule_info.rule.dispatch_rule_direct.room_name or ""


def _room_config_has_agent(
    room_config: Optional[api.RoomConfiguration],
    agent_name: str,
) -> bool:
    if room_config is None:
        return False
    for agent in room_config.agents:
        if agent.agent_name == agent_name:
            return True
    return False


async def ensure_room(
    *,
    room: str,
    empty_timeout: int,
    max_participants: int,
    metadata: str,
) -> None:
    livekit_url = _required_env("LIVEKIT_URL")
    api_key = _required_env("LIVEKIT_API_KEY")
    api_secret = _required_env("LIVEKIT_API_SECRET")

    async with api.LiveKitAPI(livekit_url, api_key, api_secret) as lkapi:
        existing = await lkapi.room.list_rooms(api.ListRoomsRequest(names=[room]))
        if existing.rooms:
            print(f"Room already exists: {room}")
            return

        created = await lkapi.room.create_room(
            api.CreateRoomRequest(
                name=room,
                empty_timeout=empty_timeout,
                max_participants=max_participants,
                metadata=metadata,
            )
        )
        print(f"Created room: {created.name}")


async def list_sip_resources() -> None:
    livekit_url = _required_env("LIVEKIT_URL")
    api_key = _required_env("LIVEKIT_API_KEY")
    api_secret = _required_env("LIVEKIT_API_SECRET")

    async with api.LiveKitAPI(livekit_url, api_key, api_secret) as lkapi:
        trunks = await lkapi.sip.list_inbound_trunk(api.ListSIPInboundTrunkRequest())
        print(f"Inbound trunks ({len(trunks.items)}):")
        for trunk in trunks.items:
            numbers = ", ".join(trunk.numbers) if trunk.numbers else "-"
            print(f"- {trunk.sip_trunk_id} | {trunk.name or '-'} | {numbers}")

        rules = await lkapi.sip.list_dispatch_rule(api.ListSIPDispatchRuleRequest())
        print(f"SIP dispatch rules ({len(rules.items)}):")
        for rule in rules.items:
            room_name = _extract_direct_room(rule) or "-"
            trunk_ids = ", ".join(rule.trunk_ids) if rule.trunk_ids else "-"
            print(f"- {rule.sip_dispatch_rule_id} | {rule.name or '-'} | room={room_name} | trunks={trunk_ids}")


async def setup_twilio_inbound(
    *,
    twilio_number: str,
    room: str,
    agent_name: str,
    trunk_name: str,
    dispatch_name: str,
) -> None:
    normalized_twilio_number = _canonical_phone(twilio_number)
    livekit_url = _required_env("LIVEKIT_URL")
    api_key = _required_env("LIVEKIT_API_KEY")
    api_secret = _required_env("LIVEKIT_API_SECRET")

    async with api.LiveKitAPI(livekit_url, api_key, api_secret) as lkapi:
        room_exists = await lkapi.room.list_rooms(api.ListRoomsRequest(names=[room]))
        if not room_exists.rooms:
            await lkapi.room.create_room(api.CreateRoomRequest(name=room))
            print(f"Created room: {room}")
        else:
            print(f"Room already exists: {room}")

        existing_trunks = await lkapi.sip.list_inbound_trunk(api.ListSIPInboundTrunkRequest())
        matching_trunk: Optional[api.SIPInboundTrunkInfo] = None
        for trunk in existing_trunks.items:
            if any(_canonical_phone(n) == normalized_twilio_number for n in trunk.numbers):
                matching_trunk = trunk
                break

        if matching_trunk is None:
            created_trunk = await lkapi.sip.create_inbound_trunk(
                api.CreateSIPInboundTrunkRequest(
                    trunk=api.SIPInboundTrunkInfo(
                        name=trunk_name,
                        numbers=[normalized_twilio_number],
                    )
                )
            )
            trunk_id = created_trunk.sip_trunk_id
            print(f"Created inbound SIP trunk: {trunk_id} for {normalized_twilio_number}")
        else:
            trunk_id = matching_trunk.sip_trunk_id
            print(f"Using existing inbound SIP trunk: {trunk_id} for {normalized_twilio_number}")

        existing_rules = await lkapi.sip.list_dispatch_rule(
            api.ListSIPDispatchRuleRequest(trunk_ids=[trunk_id])
        )
        matching_rule: Optional[api.SIPDispatchRuleInfo] = None
        for rule in existing_rules.items:
            if _extract_direct_room(rule) != room:
                continue
            if not _room_config_has_agent(rule.room_config, agent_name):
                continue
            matching_rule = rule
            break

        if matching_rule is None:
            created_rule = await lkapi.sip.create_dispatch_rule(
                api.CreateSIPDispatchRuleRequest(
                    name=dispatch_name,
                    trunk_ids=[trunk_id],
                    rule=api.SIPDispatchRule(
                        dispatch_rule_direct=api.SIPDispatchRuleDirect(room_name=room),
                    ),
                    room_config=api.RoomConfiguration(
                        agents=[api.RoomAgentDispatch(agent_name=agent_name)],
                    ),
                )
            )
            print(
                "Created SIP dispatch rule: "
                f"{created_rule.sip_dispatch_rule_id} (room={room}, agent={agent_name})"
            )
        else:
            print(
                "Using existing SIP dispatch rule: "
                f"{matching_rule.sip_dispatch_rule_id} (room={room}, agent={agent_name})"
            )

    print("")
    print("Next in Twilio:")
    print("1. Twilio Elastic SIP Trunking -> set Origination SIP URI to your LiveKit SIP URI + ';transport=tcp'.")
    print("2. Associate your Twilio phone number with that Twilio SIP trunk.")
    print("3. Call the Twilio number; LiveKit will route it to this room and dispatch your agent.")


async def list_rooms() -> None:
    livekit_url = _required_env("LIVEKIT_URL")
    api_key = _required_env("LIVEKIT_API_KEY")
    api_secret = _required_env("LIVEKIT_API_SECRET")

    async with api.LiveKitAPI(livekit_url, api_key, api_secret) as lkapi:
        response = await lkapi.room.list_rooms(api.ListRoomsRequest())
        if not response.rooms:
            print("No rooms found.")
            return
        for room in response.rooms:
            print(room.name)


async def delete_room(room: str) -> None:
    livekit_url = _required_env("LIVEKIT_URL")
    api_key = _required_env("LIVEKIT_API_KEY")
    api_secret = _required_env("LIVEKIT_API_SECRET")

    async with api.LiveKitAPI(livekit_url, api_key, api_secret) as lkapi:
        await lkapi.room.delete_room(api.DeleteRoomRequest(room=room))
        print(f"Deleted room: {room}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="LiveKit room + token utilities for local playground testing."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    ensure_room_parser = subparsers.add_parser("ensure-room", help="Create room only if missing.")
    ensure_room_parser.add_argument("--room", required=False, default="policy-playground-room")
    ensure_room_parser.add_argument("--empty-timeout", type=int, default=10 * 60)
    ensure_room_parser.add_argument("--max-participants", type=int, default=10)
    ensure_room_parser.add_argument("--metadata", default="")

    subparsers.add_parser("list-rooms", help="List existing rooms.")

    delete_room_parser = subparsers.add_parser("delete-room", help="Delete a room.")
    delete_room_parser.add_argument("--room", required=True)

    subparsers.add_parser("list-sip", help="List LiveKit inbound SIP trunks and SIP dispatch rules.")

    twilio_parser = subparsers.add_parser(
        "setup-twilio-inbound",
        help="Ensure LiveKit inbound SIP trunk + dispatch rule for a Twilio phone number.",
    )
    twilio_parser.add_argument("--phone-number", required=True, help="Twilio phone number in E.164 format.")
    twilio_parser.add_argument("--room", required=False, default="policy-playground-room")
    twilio_parser.add_argument("--agent-name", required=False, default=os.getenv("AGENT_NAME", "Policy_Agent"))
    twilio_parser.add_argument("--trunk-name", required=False, default="twilio-inbound-trunk")
    twilio_parser.add_argument("--dispatch-name", required=False, default="twilio-direct-dispatch")

    token_parser = subparsers.add_parser("create-token", help="Create participant join token.")
    token_parser.add_argument("--room", required=False, default="policy-playground-room")
    token_parser.add_argument("--identity", required=False, default=f"user-{uuid.uuid4().hex[:8]}")
    token_parser.add_argument("--name", required=False, default="Playground User")
    token_parser.add_argument("--ttl", required=False, default="24h")
    token_parser.add_argument(
        "--agent-name",
        required=False,
        default=os.getenv("AGENT_NAME", "Policy_Agent"),
        help="Set to empty string to skip agent dispatch in room_config.",
    )

    return parser


async def _run_async(args: argparse.Namespace) -> None:
    if args.command == "ensure-room":
        await ensure_room(
            room=args.room,
            empty_timeout=args.empty_timeout,
            max_participants=args.max_participants,
            metadata=args.metadata,
        )
        return
    if args.command == "list-rooms":
        await list_rooms()
        return
    if args.command == "list-sip":
        await list_sip_resources()
        return
    if args.command == "delete-room":
        await delete_room(args.room)
        return
    if args.command == "setup-twilio-inbound":
        await setup_twilio_inbound(
            twilio_number=args.phone_number,
            room=args.room,
            agent_name=args.agent_name,
            trunk_name=args.trunk_name,
            dispatch_name=args.dispatch_name,
        )
        return
    if args.command == "create-token":
        token = create_join_token(
            room=args.room,
            identity=args.identity,
            participant_name=args.name,
            ttl=args.ttl,
            agent_name=args.agent_name or None,
        )
        print(f"LIVEKIT_URL={_required_env('LIVEKIT_URL')}")
        print(f"ROOM={args.room}")
        print(f"IDENTITY={args.identity}")
        print("TOKEN_START")
        print(token)
        print("TOKEN_END")
        return
    raise ValueError(f"Unsupported command: {args.command}")


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    asyncio.run(_run_async(args))


if __name__ == "__main__":
    main()
