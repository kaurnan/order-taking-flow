# Daily Account Usage Implementation

## Overview

This document describes the implementation of the daily account usage system for tracking WhatsApp Business API (WABA) conversation analytics from both Gupshup and Interakt Business Service Providers (BSPs).

## Architecture

The system consists of several components working together to provide comprehensive usage tracking:

### 1. Data Models

#### Daily Account Usage (`models/billing/daily_account_usage.model.js`)

-   Tracks daily usage metrics per channel per organisation
-   Includes conversation analytics (marketing, utility, authentication, service)
-   Stores message counts and conversation counts
-   Indexed for efficient querying

#### Monthly Account Usage (`models/billing/monthy_account_usgae.model.js`)

-   Aggregates daily usage into monthly totals
-   Includes cost calculations and cumulative metrics
-   Maintains historical data for billing and analytics

### 2. Services

#### Daily Usage Service (`services/billing/daily_usage.service.js`)

-   Fetches conversation analytics from Gupshup and Interakt APIs
-   Processes and stores daily usage data
-   Updates monthly usage aggregations
-   Handles BSP-specific data parsing

#### Daily Usage Jobs Service (`services/billing/daily_usage_jobs.service.js`)

-   Manages recurring daily usage jobs for each organisation
-   Handles job scheduling, removal, and monitoring
-   Creates monthly usage documents for new organisations
-   Initializes existing organisations on service startup

### 3. Queue System

#### Daily Usage Queue (`queues/daily_usage.queue.js`)

-   Redis-based job queue using Bull
-   Handles organisation-specific daily usage processing
-   Configurable retry and failure handling

#### Daily Usage Worker (`workers/core/daily_usage.worker.js`)

-   Processes daily usage jobs from the queue
-   Fetches analytics from BSP APIs
-   Stores data in MongoDB
-   Handles errors and logging

## Implementation Details

### 1. Job Scheduling

Each organisation gets its own daily usage job scheduled at 9:00 AM:

```javascript
// Cron expression: Every morning at 9:00 AM
cron: "0 9 * * *";
```

### 2. Data Flow

1. **Daily Job Execution**: At 9:00 AM, the system processes the previous day's usage
2. **BSP API Calls**: Fetches conversation analytics from Gupshup and Interakt
3. **Data Processing**: Extracts usage metrics and categorizes conversations
4. **Storage**: Updates daily and monthly usage records
5. **Aggregation**: Accumulates daily data into monthly totals

### 3. Conversation Analytics

The system tracks four main conversation categories:

-   **Marketing**: Promotional and marketing-related conversations
-   **Utility**: Customer service and utility conversations
-   **Authentication**: Security and verification conversations
-   **Service**: General service-related conversations

### 4. BSP Integration

#### Gupshup

-   Uses Partner API v3 for analytics
-   Requires app_id and token from channel configuration
-   Fetches conversation data with daily granularity

#### Interakt

-   Uses Facebook Graph API for conversation analytics
-   Requires access token and WABA ID
-   Fetches data with conversation category dimensions

## Setup and Configuration

### 1. Environment Variables

```bash
# Redis Configuration
REDIS_URI=redis://localhost:6379

# MongoDB Configuration
MONGODB_URI=mongodb://localhost:27017/flowflex

# Gupshup Configuration
GUPSHUP_PARTNER_API=https://api.gupshup.io

# Interakt Configuration
INTERAKT_API=https://graph.facebook.com/v23.0
INTERAKT_TOKEN=your_interakt_access_token
```

### 2. Service Registration

Add the new services to your Moleculer configuration:

```javascript
// moleculer.config.js
services: [
    // ... existing services
    "services/billing/daily_usage.service.js",
    "services/billing/daily_usage_jobs.service.js",
];
```

### 3. Worker Management

The daily usage worker is managed through the existing `workers.service` and will be automatically started with the system. The Bull dashboard is integrated into `api.service` for monitoring and management.

## Usage

### 1. Automatic Setup

The system automatically sets up daily usage tracking when:

-   A new organisation is created
-   The service starts up (for existing organisations)

### 2. Manual Operations

#### Schedule Daily Usage Job

```javascript
await ctx.call("daily_usage_jobs.scheduleDailyUsageJob", {
    org_id: "organisation_id",
});
```

#### Remove Daily Usage Job

```javascript
await ctx.call("daily_usage_jobs.removeDailyUsageJob", {
    org_id: "organisation_id",
});
```

#### Create Monthly Usage Documents

```javascript
await ctx.call("daily_usage_jobs.createMonthlyUsageDocument", {
    org_id: "organisation_id",
});
```

#### Trigger Manual Processing

```javascript
await ctx.call("daily_usage_jobs.triggerDailyUsage", {
    org_id: "organisation_id",
    date: "2024-01-15", // Optional, defaults to today
});
```

#### Get Scheduled Jobs

```javascript
await ctx.call("daily_usage_jobs.getScheduledJobs");
```

### 3. Data Queries

#### Daily Usage by Organisation

```javascript
// Find daily usage for a specific organisation and date
const dailyUsage = await DailyUsage.find({
    org_id: "organisation_id",
    date: {
        $gte: startDate,
        $lt: endDate,
    },
});
```

#### Monthly Usage Aggregation

```javascript
// Find monthly usage for a specific organisation
const monthlyUsage = await MonthlyUsage.find({
    org_id: "organisation_id",
    month: 1, // January
    year: 2024,
});
```

## Monitoring and Maintenance

### 1. Job Monitoring

Monitor daily usage jobs through:

-   Bull Queue Dashboard
-   Service logs
-   Job status endpoints

### 2. Error Handling

The system includes comprehensive error handling:

-   BSP API failures are logged and skipped
-   Channel processing errors don't stop other channels
-   Failed jobs are retried with exponential backoff
-   All errors are logged for debugging

### 3. Data Consistency

-   Unique indexes prevent duplicate records
-   Upsert operations handle existing data updates
-   Transaction-like behavior for daily/monthly updates

## Performance Considerations

### 1. Batch Processing

-   Processes one organisation at a time
-   Channels within an organisation are processed sequentially
-   API rate limits are respected through delays

### 2. Database Optimization

-   Compound indexes for efficient queries
-   TTL indexes for data retention
-   Efficient aggregation queries

### 3. Queue Management

-   Configurable job timeouts
-   Automatic job cleanup
-   Failed job retention for debugging

## Troubleshooting

### 1. Common Issues

#### Jobs Not Running

-   Check Redis connection
-   Verify cron expressions
-   Check service dependencies

#### API Failures

-   Verify BSP credentials
-   Check API rate limits
-   Review network connectivity

#### Data Missing

-   Check MongoDB connections
-   Verify model schemas
-   Review job execution logs

### 2. Debug Commands

#### Check Job Status

```javascript
await ctx.call("daily_usage_jobs.getScheduledJobs");
```

#### Manual Trigger

```javascript
await ctx.call("daily_usage_jobs.triggerDailyUsage", {
    org_id: "organisation_id",
});
```

#### Verify Data

```javascript
// Check daily usage records
const dailyRecords = await DailyUsage.find({ org_id: "organisation_id" });

// Check monthly usage records
const monthlyRecords = await MonthlyUsage.find({ org_id: "organisation_id" });
```

## Future Enhancements

### 1. Real-time Processing

-   Webhook-based usage updates
-   Real-time analytics dashboard
-   Instant billing calculations

### 2. Advanced Analytics

-   Usage trend analysis
-   Predictive billing
-   Cost optimization recommendations

### 3. Multi-tenant Support

-   Organisation-specific configurations
-   Custom BSP integrations
-   Flexible scheduling options

## Conclusion

The daily account usage system provides a robust, scalable solution for tracking WhatsApp Business API usage across multiple BSPs and organisations. The implementation follows best practices for job scheduling, error handling, and data consistency, ensuring reliable operation in production environments.
