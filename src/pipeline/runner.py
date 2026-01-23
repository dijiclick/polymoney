"""Main pipeline runner."""

import asyncio
import logging
from datetime import datetime
from typing import Optional, TYPE_CHECKING

from ..database.supabase import get_supabase_client
from ..database.models import PipelineRun
from ..config.filters import FilterConfig
from .step1_goldsky import Step1Goldsky
from .step2_balance import Step2Balance
from .step3_positions import Step3Positions
from .step4_winrate import Step4WinRate
from .step5_analysis import Step5Analysis
from .step6_classify import Step6Classify

if TYPE_CHECKING:
    from .tracker import PipelineTracker

logger = logging.getLogger(__name__)


class PipelineRunner:
    """Orchestrate the complete trader analysis pipeline."""

    def __init__(
        self,
        filters: Optional[FilterConfig] = None,
        tracker: Optional["PipelineTracker"] = None
    ):
        """
        Initialize the pipeline runner.

        Args:
            filters: Optional filter configuration
            tracker: Optional PipelineTracker for real-time dashboard updates.
                     If provided, progress will be pushed to Supabase for the
                     live dashboard to display.
        """
        self.filters = filters or FilterConfig.load()
        self.db = get_supabase_client()
        self.tracker = tracker

        # Initialize steps
        self.step1 = Step1Goldsky(filters)
        self.step2 = Step2Balance(filters)
        self.step3 = Step3Positions(filters)
        self.step4 = Step4WinRate(filters)
        self.step5 = Step5Analysis(filters)
        self.step6 = Step6Classify(filters)

        self._run_id: Optional[int] = None
        self._stats = {}

    async def run_full(
        self,
        days: int = 30,
        progress_callback: Optional[callable] = None,
        step_callback: Optional[callable] = None
    ) -> dict:
        """
        Run the complete pipeline from scratch.

        Args:
            days: Number of days to analyze
            progress_callback: Optional callback for progress updates.
                Signature: callback(step_name, processed, total, qualified, eliminated=0)
            step_callback: Optional callback when a step completes.
                Signature: step_callback(step_num)

        Returns:
            Statistics dictionary
        """
        logger.info(f"Starting full pipeline run for {days} days")
        start_time = datetime.now()

        # Create pipeline run record (use tracker if available)
        if self.tracker:
            self._run_id = self.tracker.start_run(days=days)
        else:
            run = PipelineRun(started_at=start_time, status="running")
            run_record = self.db.create_pipeline_run(run.to_dict())
            self._run_id = run_record.get("id")

        # Helper to wrap callbacks with step info
        def make_step_callback(step_name: str, step_num: int):
            def wrapper(processed, total, qualified, eliminated=0):
                if progress_callback:
                    progress_callback(step_name, processed, total, qualified, eliminated)
                # Also update tracker if available
                if self.tracker:
                    self.tracker.update_progress(step_num, processed, qualified, total)
            return wrapper

        try:
            # Step 1: Goldsky extraction
            logger.info("=" * 50)
            logger.info("STEP 1: Goldsky Extraction")
            logger.info("=" * 50)
            if self.tracker:
                self.tracker.start_step(1)
            step1_cb = make_step_callback("Goldsky Extraction", 1)
            step1_result = await self.step1.run(days=days, progress_callback=step1_cb)
            self._update_run_stats(step1_result, "step1")
            if self.tracker:
                self.tracker.complete_step(1, step1_result.get("qualified", 0))
            if step_callback:
                step_callback(1)

            # Step 2: Balance check
            logger.info("=" * 50)
            logger.info("STEP 2: Balance Check")
            logger.info("=" * 50)
            if self.tracker:
                self.tracker.start_step(2, step1_result.get("qualified", 0))
            step2_cb = make_step_callback("Balance Check", 2)
            step2_result = await self.step2.run(progress_callback=step2_cb)
            self._update_run_stats(step2_result, "step2")
            if self.tracker:
                self.tracker.complete_step(2, step2_result.get("qualified", 0))
            if step_callback:
                step_callback(2)

            # Step 3: Position analysis
            logger.info("=" * 50)
            logger.info("STEP 3: Position Analysis")
            logger.info("=" * 50)
            if self.tracker:
                self.tracker.start_step(3, step2_result.get("qualified", 0))
            step3_cb = make_step_callback("Position Analysis", 3)
            step3_result = await self.step3.run(progress_callback=step3_cb)
            self._update_run_stats(step3_result, "step3")
            if self.tracker:
                self.tracker.complete_step(3, step3_result.get("qualified", 0))
            if step_callback:
                step_callback(3)

            # Step 4: Win rate calculation
            logger.info("=" * 50)
            logger.info("STEP 4: Win Rate Calculation")
            logger.info("=" * 50)
            if self.tracker:
                self.tracker.start_step(4, step3_result.get("qualified", 0))
            step4_cb = make_step_callback("Win Rate Calc", 4)
            step4_result = await self.step4.run(progress_callback=step4_cb)
            self._update_run_stats(step4_result, "step4")
            if self.tracker:
                self.tracker.complete_step(4, step4_result.get("qualified", 0))
            if step_callback:
                step_callback(4)

            # Step 5: Deep analysis
            logger.info("=" * 50)
            logger.info("STEP 5: Deep Analysis")
            logger.info("=" * 50)
            if self.tracker:
                self.tracker.start_step(5, step4_result.get("qualified", 0))
            step5_cb = make_step_callback("Deep Analysis", 5)
            step5_result = await self.step5.run(progress_callback=step5_cb)
            self._update_run_stats(step5_result, "step5")
            if self.tracker:
                self.tracker.complete_step(5, step5_result.get("analyzed", 0))
            if step_callback:
                step_callback(5)

            # Step 6: Classification
            logger.info("=" * 50)
            logger.info("STEP 6: Classification")
            logger.info("=" * 50)
            if self.tracker:
                self.tracker.start_step(6, step5_result.get("analyzed", 0))
            step6_cb = make_step_callback("Classification", 6)
            step6_result = self.step6.run(progress_callback=step6_cb)
            self._update_run_stats(step6_result, "step6")
            if self.tracker:
                self.tracker.complete_step(6, step6_result.get("classified", 0))
            if step_callback:
                step_callback(6)

            # Complete
            end_time = datetime.now()
            duration = int((end_time - start_time).total_seconds())

            # Complete the run
            if self.tracker:
                self.tracker.complete_run(
                    copytrade=step6_result.get("copytrade_candidates", 0),
                    bot=step6_result.get("likely_bots", 0)
                )
            else:
                self.db.update_pipeline_run(self._run_id, {
                    "status": "completed",
                    "completed_at": end_time.isoformat(),
                    "duration_seconds": duration,
                    "final_qualified": step6_result.get("classified", 0),
                    "copytrade_found": step6_result.get("copytrade_candidates", 0),
                    "bot_found": step6_result.get("likely_bots", 0)
                })

            logger.info("=" * 50)
            logger.info("PIPELINE COMPLETE")
            logger.info(f"Duration: {duration} seconds")
            logger.info(f"Total qualified: {step6_result.get('classified', 0)}")
            logger.info(f"Copy trade candidates: {step6_result.get('copytrade_candidates', 0)}")
            logger.info(f"Likely bots: {step6_result.get('likely_bots', 0)}")
            logger.info("=" * 50)

            return {
                "status": "completed",
                "duration_seconds": duration,
                "step1": step1_result,
                "step2": step2_result,
                "step3": step3_result,
                "step4": step4_result,
                "step5": step5_result,
                "step6": step6_result
            }

        except Exception as e:
            logger.error(f"Pipeline failed: {e}")
            if self.tracker:
                self.tracker.fail_run(str(e))
            else:
                self.db.update_pipeline_run(self._run_id, {
                    "status": "failed",
                    "error_log": str(e)
                })
            raise

    async def run_incremental(
        self,
        days: int = 1,
        progress_callback: Optional[callable] = None,
        step_callback: Optional[callable] = None
    ) -> dict:
        """
        Run incremental update (new addresses only).

        Args:
            days: Number of days to check for new addresses
            progress_callback: Optional callback for progress updates.
                Signature: callback(step_name, processed, total, qualified, eliminated=0)
            step_callback: Optional callback when a step completes.
                Signature: step_callback(step_num)
        """
        logger.info(f"Starting incremental pipeline run for {days} days")
        start_time = datetime.now()

        # Create pipeline run record
        run = PipelineRun(started_at=start_time, status="running")
        run_record = self.db.create_pipeline_run(run.to_dict())
        self._run_id = run_record.get("id")

        # Helper to wrap callbacks with step info
        def make_step_callback(step_name: str):
            if not progress_callback:
                return None
            def wrapper(processed, total, qualified, eliminated=0):
                progress_callback(step_name, processed, total, qualified, eliminated)
            return wrapper

        try:
            # Step 1: Get new addresses only
            step1_cb = make_step_callback("Goldsky Extraction")
            step1_result = await self.step1.run_incremental(days=days, progress_callback=step1_cb)
            if step_callback:
                step_callback(1)

            if step1_result.get("new_addresses", 0) == 0:
                logger.info("No new addresses found")
                self.db.update_pipeline_run(self._run_id, {
                    "status": "completed",
                    "completed_at": datetime.now().isoformat(),
                    "addresses_found": 0
                })
                return {"status": "completed", "new_addresses": 0}

            # Run remaining steps for new addresses
            step2_cb = make_step_callback("Balance Check")
            step2_result = await self.step2.run(progress_callback=step2_cb)
            if step_callback:
                step_callback(2)

            step3_cb = make_step_callback("Position Analysis")
            step3_result = await self.step3.run(progress_callback=step3_cb)
            if step_callback:
                step_callback(3)

            step4_cb = make_step_callback("Win Rate Calc")
            step4_result = await self.step4.run(progress_callback=step4_cb)
            if step_callback:
                step_callback(4)

            step5_cb = make_step_callback("Deep Analysis")
            step5_result = await self.step5.run(progress_callback=step5_cb)
            if step_callback:
                step_callback(5)

            step6_cb = make_step_callback("Classification")
            step6_result = self.step6.run(progress_callback=step6_cb)
            if step_callback:
                step_callback(6)

            end_time = datetime.now()
            duration = int((end_time - start_time).total_seconds())

            self.db.update_pipeline_run(self._run_id, {
                "status": "completed",
                "completed_at": end_time.isoformat(),
                "duration_seconds": duration,
                "addresses_found": step1_result.get("new_addresses", 0),
                "final_qualified": step6_result.get("classified", 0)
            })

            return {
                "status": "completed",
                "duration_seconds": duration,
                "new_addresses": step1_result.get("new_addresses", 0),
                "qualified": step6_result.get("classified", 0)
            }

        except Exception as e:
            logger.error(f"Incremental pipeline failed: {e}")
            self.db.update_pipeline_run(self._run_id, {
                "status": "failed",
                "error_log": str(e)
            })
            raise

    async def run_from_step(
        self,
        start_step: int,
        progress_callback: Optional[callable] = None,
        step_callback: Optional[callable] = None
    ) -> dict:
        """
        Resume pipeline from a specific step.

        Useful if pipeline was interrupted.

        Args:
            start_step: Step number to start from (2-6)
            progress_callback: Optional callback for progress updates.
                Signature: callback(step_name, processed, total, qualified, eliminated=0)
            step_callback: Optional callback when a step completes.
                Signature: step_callback(step_num)
        """
        logger.info(f"Resuming pipeline from step {start_step}")

        # Helper to wrap callbacks with step info
        def make_step_cb(step_name: str):
            if not progress_callback:
                return None
            def wrapper(processed, total, qualified, eliminated=0):
                progress_callback(step_name, processed, total, qualified, eliminated)
            return wrapper

        results = {}

        if start_step <= 2:
            results["step2"] = await self.step2.run(progress_callback=make_step_cb("Balance Check"))
            if step_callback:
                step_callback(2)
        if start_step <= 3:
            results["step3"] = await self.step3.run(progress_callback=make_step_cb("Position Analysis"))
            if step_callback:
                step_callback(3)
        if start_step <= 4:
            results["step4"] = await self.step4.run(progress_callback=make_step_cb("Win Rate Calc"))
            if step_callback:
                step_callback(4)
        if start_step <= 5:
            results["step5"] = await self.step5.run(progress_callback=make_step_cb("Deep Analysis"))
            if step_callback:
                step_callback(5)
        if start_step <= 6:
            results["step6"] = self.step6.run(progress_callback=make_step_cb("Classification"))
            if step_callback:
                step_callback(6)

        return results

    def _update_run_stats(self, result: dict, step: str):
        """Update pipeline run statistics."""
        self._stats[step] = result

        update_data = {}
        if step == "step1":
            update_data["addresses_found"] = result.get("total_found", 0)
            update_data["step1_passed"] = result.get("qualified", 0)
        elif step == "step2":
            update_data["step2_passed"] = result.get("qualified", 0)
        elif step == "step3":
            update_data["step3_passed"] = result.get("qualified", 0)
        elif step == "step4":
            update_data["step4_passed"] = result.get("qualified", 0)
        elif step == "step5":
            update_data["step5_passed"] = result.get("analyzed", 0)

        if update_data and self._run_id:
            self.db.update_pipeline_run(self._run_id, update_data)

    def get_pipeline_status(self) -> dict:
        """Get current pipeline status."""
        counts = self.db.count_traders_by_step()
        latest_run = self.db.get_latest_pipeline_run()

        return {
            "traders_by_step": counts,
            "latest_run": latest_run,
            "current_stats": self._stats
        }
