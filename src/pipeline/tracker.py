"""Real-time pipeline progress tracker for Supabase dashboard."""

from datetime import datetime
from typing import Optional, Any
import logging

from supabase import create_client, Client

logger = logging.getLogger(__name__)


class PipelineTracker:
    """
    Real-time pipeline progress tracker that writes to Supabase.

    This enables live dashboard updates via Supabase real-time subscriptions.
    All progress, logs, and statistics are pushed to the database for the
    Next.js dashboard to consume.
    """

    STEP_NAMES = {
        1: 'Goldsky Extraction',
        2: 'Balance Check',
        3: 'Positions Analysis',
        4: 'Win Rate Calculation',
        5: 'Deep Analysis',
        6: 'Classification'
    }

    def __init__(self, supabase_url: str, supabase_key: str):
        """
        Initialize the tracker with Supabase credentials.

        Args:
            supabase_url: Supabase project URL
            supabase_key: Supabase service role key (for write access)
        """
        self.supabase: Client = create_client(supabase_url, supabase_key)
        self.run_id: Optional[str] = None
        self._current_step: int = 0
        self._step_start_times: dict[int, datetime] = {}

    def start_run(self, days: int = 30, config: Optional[dict] = None) -> str:
        """
        Create a new pipeline run and return the run ID.

        Args:
            days: Number of days to scan
            config: Optional configuration dictionary

        Returns:
            The UUID of the new pipeline run
        """
        config = config or {}

        # Create pipeline run
        result = self.supabase.table('pipeline_runs').insert({
            'status': 'running',
            'days_to_scan': days,
            'config': config,
            'started_at': datetime.now().isoformat(),
            'progress_percent': 0
        }).execute()

        self.run_id = result.data[0]['id']

        # Create progress entries for each step
        progress_entries = [
            {
                'run_id': self.run_id,
                'step_number': step,
                'step_name': name,
                'status': 'pending'
            }
            for step, name in self.STEP_NAMES.items()
        ]

        self.supabase.table('pipeline_progress').insert(progress_entries).execute()

        self.log('info', f'Pipeline started - scanning {days} days')
        logger.info(f'Started pipeline run: {self.run_id}')

        return self.run_id

    def start_step(self, step: int, total_items: int = 0):
        """
        Mark a step as started.

        Args:
            step: Step number (1-6)
            total_items: Total items to process in this step
        """
        self._current_step = step
        self._step_start_times[step] = datetime.now()
        step_name = self.STEP_NAMES.get(step, f'Step {step}')

        # Update progress table
        self.supabase.table('pipeline_progress').update({
            'status': 'running',
            'total_items': total_items,
            'processed_items': 0,
            'passed_items': 0,
            'failed_items': 0,
            'started_at': datetime.now().isoformat()
        }).eq('run_id', self.run_id).eq('step_number', step).execute()

        # Update run table
        self.supabase.table('pipeline_runs').update({
            'current_step': step,
            'current_step_name': step_name
        }).eq('id', self.run_id).execute()

        self.log('info', f'Starting {step_name}', step=step)
        logger.info(f'Step {step} ({step_name}) started with {total_items} items')

    def update_progress(
        self,
        step: int,
        processed: int,
        passed: int,
        total: Optional[int] = None
    ):
        """
        Update step progress.

        Args:
            step: Step number
            processed: Number of items processed
            passed: Number of items that passed the step
            total: Optional total items (updates if provided)
        """
        update_data = {
            'processed_items': processed,
            'passed_items': passed,
            'failed_items': processed - passed,
            'updated_at': datetime.now().isoformat()
        }

        if total is not None:
            update_data['total_items'] = total

        # Calculate speed if we have start time
        if step in self._step_start_times:
            elapsed = (datetime.now() - self._step_start_times[step]).total_seconds()
            if elapsed > 0 and processed > 0:
                speed = processed / elapsed
                update_data['items_per_second'] = round(speed, 2)

                # Estimate remaining time
                if total and total > processed:
                    remaining_items = total - processed
                    estimated_seconds = int(remaining_items / speed)
                    update_data['estimated_remaining_seconds'] = estimated_seconds

        self.supabase.table('pipeline_progress').update(
            update_data
        ).eq('run_id', self.run_id).eq('step_number', step).execute()

        # Update overall progress (6 steps, each worth ~16.67%)
        if total and total > 0:
            step_progress = (processed / total) * 100
            overall = (step - 1) * 16.67 + (step_progress * 16.67 / 100)

            self.supabase.table('pipeline_runs').update({
                'progress_percent': min(round(overall, 2), 100)
            }).eq('id', self.run_id).execute()

    def complete_step(self, step: int, passed: int):
        """
        Mark a step as completed.

        Args:
            step: Step number
            passed: Number of items that passed
        """
        step_name = self.STEP_NAMES.get(step, f'Step {step}')

        # Update progress table
        self.supabase.table('pipeline_progress').update({
            'status': 'completed',
            'passed_items': passed,
            'completed_at': datetime.now().isoformat()
        }).eq('run_id', self.run_id).eq('step_number', step).execute()

        # Update run stats
        step_field = f'step{step}_passed'
        self.supabase.table('pipeline_runs').update({
            step_field: passed
        }).eq('id', self.run_id).execute()

        self.log('success', f'{step_name} completed: {passed:,} passed', step=step)
        logger.info(f'Step {step} completed: {passed} items passed')

    def log(
        self,
        level: str,
        message: str,
        step: Optional[int] = None,
        address: Optional[str] = None,
        details: Optional[dict] = None
    ):
        """
        Add a log entry to the pipeline logs.

        Args:
            level: Log level (debug, info, success, warning, error)
            message: Log message
            step: Optional step number
            address: Optional trader address
            details: Optional extra details as dict
        """
        log_entry = {
            'run_id': self.run_id,
            'level': level,
            'message': message,
            'step_number': step or self._current_step,
            'address': address,
            'details': details,
            'timestamp': datetime.now().isoformat()
        }

        try:
            self.supabase.table('pipeline_logs').insert(log_entry).execute()
        except Exception as e:
            # Don't fail the pipeline if logging fails
            logger.warning(f'Failed to write log to Supabase: {e}')

    def log_trader_check(
        self,
        address: str,
        passed: bool,
        reason: str,
        step: int
    ):
        """
        Log an individual trader check result.

        Args:
            address: Trader address
            passed: Whether the trader passed
            reason: Reason for pass/fail
            step: Step number
        """
        level = 'success' if passed else 'info'
        icon = 'Passed' if passed else 'Eliminated'
        short_addr = f'{address[:10]}...'
        self.log(level, f'{icon} {short_addr} - {reason}', step=step, address=address)

    def update_stats(
        self,
        addresses_found: Optional[int] = None,
        addresses_processed: Optional[int] = None,
        addresses_qualified: Optional[int] = None,
        api_calls_total: Optional[int] = None
    ):
        """
        Update pipeline statistics.

        Args:
            addresses_found: Total addresses found
            addresses_processed: Addresses processed so far
            addresses_qualified: Addresses that qualified
            api_calls_total: Total API calls made
        """
        stats_entry = {
            'run_id': self.run_id,
            'timestamp': datetime.now().isoformat()
        }

        if addresses_found is not None:
            stats_entry['addresses_found'] = addresses_found
        if addresses_processed is not None:
            stats_entry['addresses_processed'] = addresses_processed
        if addresses_qualified is not None:
            stats_entry['addresses_qualified'] = addresses_qualified
        if api_calls_total is not None:
            stats_entry['api_calls_total'] = api_calls_total

        self.supabase.table('pipeline_stats').insert(stats_entry).execute()

        # Also update run table
        run_update = {}
        if addresses_found is not None:
            run_update['total_addresses_found'] = addresses_found
        if api_calls_total is not None:
            run_update['api_calls_made'] = api_calls_total

        if run_update:
            self.supabase.table('pipeline_runs').update(
                run_update
            ).eq('id', self.run_id).execute()

    def complete_run(self, copytrade: int, bot: int):
        """
        Mark the entire pipeline run as completed.

        Args:
            copytrade: Number of copy trade candidates found
            bot: Number of bots found
        """
        total_qualified = copytrade + bot

        self.supabase.table('pipeline_runs').update({
            'status': 'completed',
            'completed_at': datetime.now().isoformat(),
            'progress_percent': 100,
            'copytrade_found': copytrade,
            'bot_found': bot,
            'final_qualified': total_qualified
        }).eq('id', self.run_id).execute()

        self.log(
            'success',
            f'Pipeline completed! Found {copytrade} copy trade candidates, {bot} bots'
        )
        logger.info(f'Pipeline completed: {copytrade} copytrade, {bot} bots')

    def fail_run(self, error: str):
        """
        Mark the pipeline run as failed.

        Args:
            error: Error message
        """
        self.supabase.table('pipeline_runs').update({
            'status': 'failed',
            'last_error': error,
            'completed_at': datetime.now().isoformat()
        }).eq('id', self.run_id).execute()

        # Mark current step as failed
        if self._current_step > 0:
            self.supabase.table('pipeline_progress').update({
                'status': 'failed'
            }).eq('run_id', self.run_id).eq('step_number', self._current_step).execute()

        self.log('error', f'Pipeline failed: {error}')
        logger.error(f'Pipeline failed: {error}')

    def cancel_run(self):
        """Mark the pipeline run as cancelled."""
        self.supabase.table('pipeline_runs').update({
            'status': 'cancelled',
            'completed_at': datetime.now().isoformat()
        }).eq('id', self.run_id).execute()

        self.log('warning', 'Pipeline cancelled by user')
        logger.info('Pipeline cancelled')

    def increment_api_calls(self, count: int = 1):
        """
        Increment the API call counter.

        Args:
            count: Number of API calls to add
        """
        # Get current count and increment
        result = self.supabase.table('pipeline_runs').select(
            'api_calls_made'
        ).eq('id', self.run_id).execute()

        current = result.data[0].get('api_calls_made', 0) if result.data else 0

        self.supabase.table('pipeline_runs').update({
            'api_calls_made': current + count
        }).eq('id', self.run_id).execute()

    def increment_errors(self, count: int = 1):
        """
        Increment the error counter.

        Args:
            count: Number of errors to add
        """
        result = self.supabase.table('pipeline_runs').select(
            'errors_count'
        ).eq('id', self.run_id).execute()

        current = result.data[0].get('errors_count', 0) if result.data else 0

        self.supabase.table('pipeline_runs').update({
            'errors_count': current + count
        }).eq('id', self.run_id).execute()


def create_tracker_from_env() -> PipelineTracker:
    """
    Create a PipelineTracker instance using environment variables.

    Returns:
        PipelineTracker instance
    """
    import os
    from dotenv import load_dotenv

    load_dotenv()

    supabase_url = os.getenv('SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_KEY')

    if not supabase_url or not supabase_key:
        raise ValueError('SUPABASE_URL and SUPABASE_KEY must be set')

    return PipelineTracker(supabase_url, supabase_key)
