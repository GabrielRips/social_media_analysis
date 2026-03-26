import { google } from 'googleapis';
import { config } from './config/index.js';

// ── Google Business Profile API ─────────────────────────────────────────────
// Handles accounts, locations, reviews, and performance insights.
// Requires OAuth2 with scope: https://www.googleapis.com/auth/business.manage
// API access must be approved by Google: https://developers.google.com/my-business/content/prereqs

function getAuth() {
  const { clientId, clientSecret, refreshToken } = config.youtube; // shared OAuth2 credentials
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('OAuth2 credentials required (YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN)');
  }
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return auth;
}

async function authHeaders() {
  const auth = getAuth();
  const { token } = await auth.getAccessToken();
  return { Authorization: `Bearer ${token}` };
}

// ── Accounts ────────────────────────────────────────────────────────────────

export async function listAccounts() {
  const headers = await authHeaders();
  const res = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', { headers });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.accounts || [];
}

// ── Locations ───────────────────────────────────────────────────────────────

export async function listLocations(accountId) {
  const headers = await authHeaders();
  const readMask = 'name,title,storefrontAddress,websiteUri,phoneNumbers,regularHours,metadata';
  const res = await fetch(
    `https://mybusinessbusinessinformation.googleapis.com/v1/${accountId}/locations?readMask=${readMask}`,
    { headers }
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.locations || [];
}

// ── Reviews ─────────────────────────────────────────────────────────────────

export async function listReviews(accountName, locationName, pageSize = 50, pageToken = null) {
  const headers = await authHeaders();
  let url = `https://mybusiness.googleapis.com/v4/${accountName}/${locationName}/reviews?pageSize=${pageSize}`;
  if (pageToken) url += `&pageToken=${pageToken}`;
  const res = await fetch(url, { headers });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return {
    reviews: data.reviews || [],
    averageRating: data.averageRating,
    totalReviewCount: data.totalReviewCount,
    nextPageToken: data.nextPageToken,
  };
}

export async function getReview(accountName, locationName, reviewId) {
  const headers = await authHeaders();
  const res = await fetch(
    `https://mybusiness.googleapis.com/v4/${accountName}/${locationName}/reviews/${reviewId}`,
    { headers }
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

export async function replyToReview(accountName, locationName, reviewId, comment) {
  const headers = await authHeaders();
  const res = await fetch(
    `https://mybusiness.googleapis.com/v4/${accountName}/${locationName}/reviews/${reviewId}/reply`,
    {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment }),
    }
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

export async function deleteReply(accountName, locationName, reviewId) {
  const headers = await authHeaders();
  const res = await fetch(
    `https://mybusiness.googleapis.com/v4/${accountName}/${locationName}/reviews/${reviewId}/reply`,
    { method: 'DELETE', headers }
  );
  if (res.status === 204) return { ok: true };
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

// ── Performance Insights ────────────────────────────────────────────────────

const DAILY_METRICS = [
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
  'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
  'BUSINESS_DIRECTION_REQUESTS',
  'CALL_CLICKS',
  'WEBSITE_CLICKS',
];

export async function getPerformance(locationName, startDate, endDate) {
  const headers = await authHeaders();
  const results = {};

  for (const metric of DAILY_METRICS) {
    const params = new URLSearchParams({
      dailyMetric: metric,
      'dailyRange.startDate.year': startDate.year,
      'dailyRange.startDate.month': startDate.month,
      'dailyRange.startDate.day': startDate.day,
      'dailyRange.endDate.year': endDate.year,
      'dailyRange.endDate.month': endDate.month,
      'dailyRange.endDate.day': endDate.day,
    });

    const res = await fetch(
      `https://businessprofileperformance.googleapis.com/v1/${locationName}:getDailyMetricsTimeSeries?${params}`,
      { headers }
    );
    const data = await res.json();
    if (data.error) {
      console.warn(`  Metric ${metric}: ${data.error.message}`);
      continue;
    }
    results[metric] = data.timeSeries?.datedValues || [];
  }

  return results;
}

export async function getSearchKeywords(locationName, year, month) {
  const headers = await authHeaders();
  const res = await fetch(
    `https://businessprofileperformance.googleapis.com/v1/${locationName}/searchkeywords/impressions/monthly?monthlyRange.startMonth.year=${year}&monthlyRange.startMonth.month=${month}&monthlyRange.endMonth.year=${year}&monthlyRange.endMonth.month=${month}`,
    { headers }
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.searchKeywordsCounts || [];
}
