# Bulk Delete Notifications

## Overview

The bulk delete notification system provides real-time feedback to users when bulk template deletion operations are completed or fail. The system integrates with the existing notification service to send appropriate notifications based on the final status of bulk delete jobs.

## Notification Types

### 1. Bulk Delete Completed

-   **Template Key**: `bulk_template_delete_completed`
-   **Trigger**: When a bulk delete job completes successfully
-   **Variables**:
    -   `totalTemplates`: Total number of templates in the bulk operation
    -   `successfulCount`: Number of templates successfully deleted
    -   `failedCount`: Number of templates that failed to delete

### 2. Bulk Delete Failed

-   **Template Key**: `bulk_template_delete_failed`
-   **Trigger**: When a bulk delete job fails completely
-   **Variables**:
    -   `totalTemplates`: Total number of templates in the bulk operation
    -   `successfulCount`: Number of templates successfully deleted
    -   `failedCount`: Number of templates that failed to delete

## Implementation Details

### Service Integration

The notification system is integrated into the WhatsApp service (`services/communication/whatsapp.service.js`) through the `updateBulkDeleteProgress` method. This method is called by the template delete worker when individual template deletion jobs complete.

### Notification Logic

```javascript
// In updateBulkDeleteProgress method
if (bulkDeleteJob.status === "completed" || bulkDeleteJob.status === "failed") {
    const templateKey =
        bulkDeleteJob.status === "completed"
            ? "bulk_template_delete_completed"
            : "bulk_template_delete_failed";

    await ctx.call("notification.sendNotification", {
        templateKey,
        variables: {
            totalTemplates: bulkDeleteJob.progress.total,
            successfulCount: bulkDeleteJob.progress.successful,
            failedCount: bulkDeleteJob.progress.failed,
        },
        additionalData: {
            organisation_id: bulkDeleteJob.org_id.toString(),
            user_id: bulkDeleteJob.metadata.initiatedBy,
        },
    });
}
```

### Configuration

Notification templates are defined in `config/notifications.json`:

```json
{
    "bulk_template_delete_completed": {
        "title": "Bulk Template Deletion Completed",
        "description": "Bulk deletion of {{totalTemplates}} templates has been completed. {{successfulCount}} templates were successfully deleted, {{failedCount}} failed.",
        "icon": "delete",
        "type": "template_delete",
        "link_template": "/templates"
    },
    "bulk_template_delete_failed": {
        "title": "Bulk Template Deletion Failed",
        "description": "Bulk deletion of {{totalTemplates}} templates has failed. {{failedCount}} templates failed to delete. Please check the templates and try again.",
        "icon": "error",
        "type": "template_delete",
        "link_template": "/templates"
    }
}
```

## Testing

Unit tests are available in `test/unit/services/whatsapp.spec.js` to verify:

-   Completion notifications are sent when bulk delete jobs complete successfully
-   Failure notifications are sent when bulk delete jobs fail
-   No notifications are sent for cancelled jobs

## Usage Examples

### Successful Bulk Delete

When a bulk delete operation completes successfully, users will receive a notification with:

-   Total number of templates processed
-   Number of successfully deleted templates
-   Number of failed deletions (if any)

### Failed Bulk Delete

When a bulk delete operation fails completely, users will receive a notification with:

-   Total number of templates that were attempted
-   Number of successful deletions (if any)
-   Number of failed deletions
-   Guidance to check templates and try again

## Monitoring

The notification system includes comprehensive logging:

-   Success logs when notifications are sent successfully
-   Error logs when notification sending fails
-   Job-specific logging for debugging purposes

## Future Enhancements

Potential improvements for the notification system:

1. **Progress Notifications**: Add intermediate progress notifications for long-running bulk operations
2. **Retry Logic**: Implement retry mechanisms for failed notification deliveries
3. **User Preferences**: Allow users to configure notification preferences
4. **Email Notifications**: Extend to include email notifications for critical operations
5. **Real-time Updates**: Implement WebSocket-based real-time progress updates

## Error Handling

The notification system is designed to be non-blocking:

-   Notification failures don't affect the core bulk delete operation
-   All notification calls are wrapped in try-catch blocks
-   Detailed error logging for debugging notification issues
-   Graceful degradation when notification service is unavailable
