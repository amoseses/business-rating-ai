import unittest

import backend


STRONG_TEXT = (
    "We help B2B software platforms launch embedded payments in 14 days instead of 4 months. "
    "Our orchestration layer routes transactions across processors, automates KYC and chargeback workflows, "
    "and gives finance teams an audit-ready ledger. We serve 46 software platforms, processed $182M annualized "
    "volume last quarter, and grew ARR from $1.1M to $2.8M in 11 months with 121% net revenue retention. "
    "We charge a SaaS subscription plus interchange share, maintain 81% gross margin, and are raising $4M to "
    "expand enterprise sales and bank partnerships while holding compliance risk low through quarterly external reviews."
)

WEAK_TEXT = (
    "We are building a revolutionary platform for everyone. The market is huge and there is basically no competition. "
    "Our product will change the world very fast and we expect explosive growth soon. We are raising money to build more features."
)


class BackendAnalysisTests(unittest.TestCase):
    def test_dataset_profile_is_exposed(self):
        self.assertGreaterEqual(backend.DATASET_PROFILE["stats"]["rows"], 6)
        self.assertIn("fintech", backend.DATASET_PROFILE["stats"]["sectors"])

    def test_strong_pitch_scores_above_weak_pitch(self):
        strong = backend.analyze_text({"text": STRONG_TEXT, "sector": "fintech", "stage": "growth"})
        weak = backend.analyze_text({"text": WEAK_TEXT, "sector": "general", "stage": "idea"})
        self.assertGreater(strong["overall_score"], weak["overall_score"])
        self.assertGreater(strong["dataset_training_detail"]["score"], weak["dataset_training_detail"]["score"])

    def test_nearest_examples_are_sorted(self):
        matches = backend.nearest_training_examples(STRONG_TEXT, sector="fintech", limit=3)
        self.assertGreaterEqual(matches[0]["similarity"], matches[-1]["similarity"])
        self.assertEqual(matches[0]["sector"], "fintech")

    def test_video_analysis_adds_visual_categories(self):
        result = backend.analyze_video({
            "transcript": STRONG_TEXT,
            "sector": "fintech",
            "stage": "growth",
            "delivery": {"energy": 0.8, "pace": 0.7},
            "image_metrics": {"brightness": 0.7, "contrast": 0.8, "sharpness": 0.75, "text_density": 0.7, "stability": 0.82},
        })
        self.assertEqual(result["mode"], "video")
        self.assertIn("visual_clarity", result["categories"])
        self.assertIn("visual_metrics", result)


    def test_training_dataset_preview_contains_pitch_preview(self):
        handler = backend.Handler
        self.assertTrue(callable(getattr(handler, 'do_GET', None)))
        preview = [{**{key: example[key] for key in ['id', 'sector', 'stage', 'rating', 'quality']}, 'pitch_preview': example['pitch'][:220]} for example in backend.TRAINING_DATASET]
        self.assertIn('pitch_preview', preview[0])
        self.assertGreater(len(preview[0]['pitch_preview']), 20)

    def test_options_and_health_support_cross_origin_frontend(self):
        self.assertTrue(hasattr(backend.Handler, 'do_OPTIONS'))
        self.assertIn('rows', backend.DATASET_PROFILE['stats'])
        self.assertTrue(hasattr(backend, 'LLM_ENDPOINT'))

    def test_rewrite_and_fix_plan_are_generated(self):
        result = backend.analyze_text({"text": WEAK_TEXT, "sector": "general", "stage": "idea"})
        self.assertTrue(result["rewrite_suggestion"])
        self.assertTrue(result["fix_plan"]["must_fix_first"])


if __name__ == "__main__":
    unittest.main()


class BackendIntegrationShapeTests(unittest.TestCase):
    def test_text_analysis_exposes_how_it_works_and_llm_status(self):
        result = backend.analyze_text({'text': STRONG_TEXT, 'sector': 'fintech', 'stage': 'growth'})
        self.assertTrue(result['how_it_works'])
        self.assertIn('status', result['llm'])

    def test_health_payload_exposes_llm_configuration_flag(self):
        self.assertTrue(callable(getattr(backend.Handler, 'do_GET', None)))

