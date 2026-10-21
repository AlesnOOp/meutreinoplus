import { healthReportSchema, type HealthReport } from '@meutreino/shared';

export function getApiBaseUrl(): string | null {
  const value = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (!value) {
    return null;
  }
  return value.replace(/\/$/, '');
}

export async function fetchHealthReport(): Promise<HealthReport> {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    throw new Error('EXPO_PUBLIC_API_URL is not configured.');
  }

  const response = await fetch(`${baseUrl}/api/v1/health`);
  const body: unknown = await response.json();
  const report = healthReportSchema.parse(body);
  if (!response.ok && report.status !== 'degraded') {
    throw new Error(`Health check failed with status ${response.status}.`);
  }
  return report;
}
