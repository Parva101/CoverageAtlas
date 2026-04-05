import unittest

IMPORT_ERROR = None
try:
    from backend.livekit.agent import _extract_context_from_metadata
except Exception as exc:  # pragma: no cover
    _extract_context_from_metadata = None
    IMPORT_ERROR = exc


@unittest.skipIf(IMPORT_ERROR is not None, f"LiveKit agent import failed: {IMPORT_ERROR}")
class LiveKitContextExtractionTests(unittest.TestCase):
    def test_extracts_user_and_insurance_context(self) -> None:
        room_meta = {
            "insurance": {
                "payer_name": "Aetna",
                "plan": {"name": "Gold Plan", "id": "plan-123"},
            }
        }
        participant_meta = {
            "user": {
                "id": "user-abc123",
                "signed_in": True,
                "is_registered": True,
            },
            "drug_name": "Ozempic",
        }

        context = _extract_context_from_metadata(room_meta, participant_meta)

        self.assertEqual(context["user_id"], "user-abc123")
        self.assertTrue(context["is_signed_in"])
        self.assertTrue(context["is_registered"])
        self.assertEqual(context["payer_name"], "Aetna")
        self.assertEqual(context["plan_name"], "Gold Plan")
        self.assertEqual(context["plan_ids"], ["plan-123"])
        self.assertEqual(context["drug_name"], "Ozempic")


if __name__ == "__main__":
    unittest.main()
