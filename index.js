import cron from 'node-cron';
import chalk from 'chalk';
import dayjs from 'dayjs';
import { validateRequiredConfig, config } from './config/index.js';
import { getDb, logRun } from './store/database.js';
import { getInboxDb } from './store/inbox-database.js';
import { runFetch } from './agents/fetcher.js';
import { runAnalysis } from './agents/analyser.js';
import { runReport } from './agents/reporter.js';
import { runInboxSweep, startReviewServer, getQueueSummary } from './agents/inbox/index.js';

// ── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap() {
  console.log(chalk.yellow('\n╔════════════════════════════════════════╗'));
  console.log(chalk.yellow('║   Third Wave BBQ — Social Agent v1.0   ║'));
  console.log(chalk.yellow('╚════════════════════════════════════════╝\n'));

  // Validate config
  const errors = validateRequiredConfig();
  if (errors.length > 0) {
    console.error(chalk.red('❌ Configuration errors:'));
    errors.forEach(e => console.error(chalk.red(`   • ${e}`)));
    console.error(chalk.dim('\n   See .env.example and the docs/ folder for setup guides.\n'));
    process.exit(1);
  }

  // Initialise DBs
  getDb();
  getInboxDb();
  console.log(chalk.green('✓ Databases ready'));

  return true;
}

// ── Main Run ─────────────────────────────────────────────────────────────────

async function runDailySweep() {
  const startTime = Date.now();
  const errors = [];
  let analysisResults = [];
  let fetchResults = { platforms: [], totalNew: 0, totalUpdated: 0, errors: [] };
  let docSuccess = false;

  console.log(chalk.cyan(`\n🔄 Starting daily sweep — ${dayjs().format('YYYY-MM-DD HH:mm:ss')}`));

  try {
    // Step 1: Fetch all platform data + run inbox sweep simultaneously
    [fetchResults] = await Promise.all([
      runFetch(),
      runInboxSweep(),
    ]);
    errors.push(...(fetchResults.errors || []));
  } catch (err) {
    const msg = `Fetch failed: ${err.message}`;
    console.error(chalk.red(msg));
    errors.push(msg);
  }

  try {
    // Step 2: Analyse with Claude
    analysisResults = await runAnalysis();
  } catch (err) {
    const msg = `Analysis failed: ${err.message}`;
    console.error(chalk.red(msg));
    errors.push(msg);
  }

  if (analysisResults.length > 0) {
    try {
      // Step 3: Write to Google Docs
      docSuccess = await runReport(analysisResults);
    } catch (err) {
      const msg = `Report failed: ${err.message}`;
      console.error(chalk.red(msg));
      errors.push(msg);
    }
  } else {
    console.log(chalk.yellow('\n⚠️  No analysis results — skipping report'));
  }

  // Log the run
  const summaryPlatforms = analysisResults.map(r => r.platform).join(', ');
  logRun({
    platforms: fetchResults.platforms,
    postsNew: fetchResults.totalNew,
    postsUpdated: fetchResults.totalUpdated,
    analysisSummary: summaryPlatforms,
    docSuccess,
    errors: errors.length > 0 ? errors : null,
  });

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(chalk.green(`\n✅ Sweep complete in ${duration}s`));

  if (errors.length > 0) {
    console.log(chalk.yellow(`⚠️  ${errors.length} non-fatal error(s) logged`));
  }

  return { analysisResults, fetchResults, docSuccess, errors };
}

// ── Entry Point ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

await bootstrap();

if (args.includes('--run-now') || args.includes('--test-fetch') || args.includes('--test-report')) {
  // Immediate one-off run
  if (args.includes('--test-fetch')) {
    console.log(chalk.cyan('\n🧪 TEST MODE — Fetch only\n'));
    await runFetch(3); // 3-day lookback for testing
  } else if (args.includes('--test-report')) {
    console.log(chalk.cyan('\n🧪 TEST MODE — Analysis + Report only (no fetch)\n'));
    const results = await runAnalysis();
    if (results.length > 0) {
      await runReport(results);
    } else {
      console.log('No data to analyse. Run --test-fetch first.');
    }
  } else {
    await runDailySweep();
  }
  process.exit(0);
}

// Scheduled mode
const schedule = config.agent.cronSchedule;
const timezone = config.agent.timezone;

// Start review dashboard (always on)
startReviewServer();

console.log(chalk.blue(`\n⏰ Scheduler active`));
console.log(chalk.blue(`   Schedule: ${schedule} (${timezone})`));
console.log(chalk.blue(`   Next run: ${getNextRunTime(schedule, timezone)}\n`));

cron.schedule(schedule, async () => {
  await runDailySweep();
}, { timezone });

// Inbox sweep runs every 15 minutes (independent of daily analytics sweep)
cron.schedule('*/15 * * * *', async () => {
  console.log(chalk.cyan(`\n📬 Inbox sweep — ${dayjs().format('HH:mm')}`));
  await runInboxSweep();
}, { timezone });

// Keep process alive
process.on('SIGTERM', () => {
  console.log('\nShutting down gracefully...');
  process.exit(0);
});

function getNextRunTime(cronExp, tz) {
  try {
    // Simple next-run estimate for display only
    return `(see cron schedule: ${cronExp})`;
  } catch {
    return 'Unknown';
  }
}
