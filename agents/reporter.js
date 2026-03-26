import { google } from 'googleapis';
import dayjs from 'dayjs';
import { config } from '../config/index.js';

// ── Write analysis results to Google Docs ───────────────────────────────────

export async function runReport(analysisResults) {
  if (!config.google.serviceAccountEmail || !config.google.docId) {
    console.log('  ⚠ Google Docs not configured — printing report to console instead');
    printConsoleReport(analysisResults);
    return false;
  }

  console.log(`\n📝 REPORTER — Writing to Google Doc...`);

  const auth = new google.auth.JWT(
    config.google.serviceAccountEmail,
    null,
    config.google.serviceAccountKey.replace(/\\n/g, '\n'),
    [
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/drive',
    ]
  );

  const docs = google.docs({ version: 'v1', auth });
  const docId = config.google.docId;

  // Build the document content
  const reportDate = dayjs().format('dddd D MMMM YYYY');
  const sections = [];

  // Header
  sections.push({
    insertText: {
      location: { index: 1 },
      text: `\n\n${'═'.repeat(60)}\nTHIRD WAVE BBQ — Social Media Report\n${reportDate}\n${'═'.repeat(60)}\n\n`,
    },
  });

  let insertIndex = 2; // Track insertion point

  for (const analysis of analysisResults) {
    const platformHeader = `── ${analysis.platform.toUpperCase()} ──────────────────────────────────\n`;
    const summarySection = `${analysis.summary || 'No summary available.'}\n\n`;

    let recommendationsSection = 'Recommendations:\n';
    const recs = typeof analysis.recommendations === 'string'
      ? JSON.parse(analysis.recommendations)
      : analysis.recommendations || [];
    for (const rec of recs) {
      recommendationsSection += `  • ${rec}\n`;
    }
    recommendationsSection += '\n';

    let topPostsSection = 'Top Performing Content:\n';
    const tops = typeof analysis.top_posts === 'string'
      ? JSON.parse(analysis.top_posts)
      : analysis.top_posts || [];
    for (const post of tops) {
      if (post.caption_preview) {
        topPostsSection += `  • "${post.caption_preview}" — ${post.why_it_worked || ''}\n`;
      } else if (post.caption) {
        topPostsSection += `  • "${post.caption}" — ${post.likes}❤ ${post.comments}💬\n`;
      }
    }
    topPostsSection += '\n';

    sections.push({
      insertText: {
        location: { index: insertIndex },
        text: platformHeader + summarySection + topPostsSection + recommendationsSection + '\n',
      },
    });
  }

  try {
    // Prepend to doc (newest report at top)
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests: sections },
    });

    console.log(`  ✅ Report written to Google Doc: ${docId}`);
    return true;
  } catch (err) {
    console.error(`  ✗ Failed to write Google Doc: ${err.message}`);
    // Fall back to console
    printConsoleReport(analysisResults);
    return false;
  }
}

// ── Fallback: print to console ──────────────────────────────────────────────

function printConsoleReport(analysisResults) {
  const reportDate = dayjs().format('dddd D MMMM YYYY');

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`THIRD WAVE BBQ — Social Media Report`);
  console.log(reportDate);
  console.log(`${'═'.repeat(60)}\n`);

  for (const analysis of analysisResults) {
    console.log(`── ${analysis.platform.toUpperCase()} ${'─'.repeat(40)}`);
    console.log(`\n${analysis.summary || 'No summary available.'}\n`);

    const recs = typeof analysis.recommendations === 'string'
      ? JSON.parse(analysis.recommendations)
      : analysis.recommendations || [];
    if (recs.length > 0) {
      console.log('Recommendations:');
      for (const rec of recs) {
        console.log(`  • ${rec}`);
      }
      console.log();
    }

    const tops = typeof analysis.top_posts === 'string'
      ? JSON.parse(analysis.top_posts)
      : analysis.top_posts || [];
    if (tops.length > 0) {
      console.log('Top Performing Content:');
      for (const post of tops) {
        if (post.caption_preview) {
          console.log(`  • "${post.caption_preview}" — ${post.why_it_worked || ''}`);
        }
      }
      console.log();
    }
  }
}
