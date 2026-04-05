import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { Ga4AdminService } from './ga4-admin.service';

export interface ReportQuery {
  dimensions: string[];
  metrics: string[];
  startDate: string;
  endDate: string;
  limit?: number;
}

@Injectable()
export class Ga4DataService implements OnModuleDestroy {
  private redis: Redis;

  constructor(
    private ga4Admin: Ga4AdminService,
    private config: ConfigService,
  ) {
    this.redis = new Redis({
      host: this.config.get('REDIS_HOST', 'localhost'),
      port: this.config.get('REDIS_PORT', 6379),
      password: this.config.get('REDIS_PASSWORD'),
    });
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }

  buildCacheKey(propertyId: string, query: ReportQuery): string {
    const hash = createHash('md5')
      .update(JSON.stringify(query))
      .digest('hex');
    return `ga4:report:${propertyId}:${hash}`;
  }

  async runReport(connectionId: string, propertyId: string, query: ReportQuery) {
    const cacheKey = this.buildCacheKey(propertyId, query);
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const auth = await this.ga4Admin.getAuthClientForConnection(connectionId);
    const analyticsData = google.analyticsdata({ version: 'v1beta', auth });

    const { data } = await analyticsData.properties.runReport({
      property: propertyId,
      requestBody: {
        dimensions: query.dimensions.map((name) => ({ name })),
        metrics: query.metrics.map((name) => ({ name })),
        dateRanges: [{ startDate: query.startDate, endDate: query.endDate }],
        limit: String(query.limit || 10000),
      },
    } as any);

    const result = {
      dimensionHeaders: (data.dimensionHeaders || []).map((h) => h.name),
      metricHeaders: (data.metricHeaders || []).map((h) => ({ name: h.name, type: h.type })),
      rows: (data.rows || []).map((row) => ({
        dimensions: (row.dimensionValues || []).map((v) => v.value),
        metrics: (row.metricValues || []).map((v) => v.value),
      })),
      rowCount: data.rowCount || 0,
    };

    await this.redis.set(cacheKey, JSON.stringify(result), 'EX', 300);
    return result;
  }

  async runRealtimeReport(connectionId: string, propertyId: string) {
    const cacheKey = `ga4:realtime:${propertyId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const auth = await this.ga4Admin.getAuthClientForConnection(connectionId);
    const analyticsData = google.analyticsdata({ version: 'v1beta', auth });

    const { data } = await analyticsData.properties.runRealtimeReport({
      property: propertyId,
      requestBody: {
        dimensions: [{ name: 'country' }],
        metrics: [{ name: 'activeUsers' }],
      },
    } as any);

    const result = {
      rows: (data.rows || []).map((row) => ({
        dimensions: (row.dimensionValues || []).map((v) => v.value),
        metrics: (row.metricValues || []).map((v) => v.value),
      })),
      rowCount: data.rowCount || 0,
    };

    await this.redis.set(cacheKey, JSON.stringify(result), 'EX', 30);
    return result;
  }

  getAvailableDimensions() {
    return [
      { name: 'date', description: 'Date' },
      { name: 'country', description: 'Country' },
      { name: 'city', description: 'City' },
      { name: 'deviceCategory', description: 'Device Category' },
      { name: 'browser', description: 'Browser' },
      { name: 'operatingSystem', description: 'Operating System' },
      { name: 'sessionSource', description: 'Traffic Source' },
      { name: 'sessionMedium', description: 'Traffic Medium' },
      { name: 'sessionCampaignName', description: 'Campaign' },
      { name: 'pagePath', description: 'Page Path' },
      { name: 'pageTitle', description: 'Page Title' },
      { name: 'language', description: 'Language' },
      { name: 'screenResolution', description: 'Screen Resolution' },
      { name: 'firstUserSource', description: 'First User Source' },
    ];
  }

  getAvailableMetrics() {
    return [
      { name: 'activeUsers', description: 'Active Users' },
      { name: 'newUsers', description: 'New Users' },
      { name: 'totalUsers', description: 'Total Users' },
      { name: 'sessions', description: 'Sessions' },
      { name: 'sessionsPerUser', description: 'Sessions per User' },
      { name: 'screenPageViews', description: 'Page Views' },
      { name: 'screenPageViewsPerSession', description: 'Pages per Session' },
      { name: 'averageSessionDuration', description: 'Avg Session Duration' },
      { name: 'bounceRate', description: 'Bounce Rate' },
      { name: 'engagementRate', description: 'Engagement Rate' },
      { name: 'engagedSessions', description: 'Engaged Sessions' },
      { name: 'eventCount', description: 'Event Count' },
      { name: 'conversions', description: 'Conversions' },
    ];
  }
}
