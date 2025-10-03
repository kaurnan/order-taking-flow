# Notification System Documentation

## Overview

The notification system provides a centralized way to manage and send notifications to Supabase. All notification content is stored in a JSON configuration file, making it easy to maintain and update without code changes.

## Configuration

### Notification Templates

All notification templates are defined in `config/notifications.json`. Each template contains:

-   **title**: The notification title
-   **description**: The notification description (supports variables)
-   **icon**: Icon identifier
-   **type**: Notification category
-   **link_template**: URL template (supports variables)

### Variable Support

Templates support variables using `{{variableName}}` syntax. Variables are replaced with actual values when sending notifications.

Example:

```json
{
    "title": "New Contact",
    "description": "{{contactName}} has been added to your contacts.",
    "link_template": "/chat?id={{contactId}}"
}
```

## Usage

### Sending Notifications

Use the notification service to send notifications:

```javascript
await ctx.call("notification.send", {
    templateKey: "new_contact",
    variables: {
        contactName: "John Doe",
        contactId: "12345",
    },
    additionalData: {
        organisation_id: "org123",
        branch_id: "branch456",
        user_id: "user789",
    },
});
```

### Available Templates

1. **flow_installation** - Flow installation completion
2. **new_contact** - New contact added
3. **bulk_action_success** - Bulk customer action success
4. **customer_export_success** - Customer export completion
5. **whatsapp_template_status** - WhatsApp template status update
6. **whatsapp_template_error** - WhatsApp template error
7. **timeline_event** - Timeline event notification

### Bulk Actions

Bulk action messages are also managed through the JSON configuration:

```javascript
const messages = await ctx.call("notification.getBulkActionMessages", {
    action: "subscribe_to_whatsapp",
});
// Returns: { title: "Subscribe to WhatsApp", success: "...", failed: "..." }
```

### Status Icons

Get appropriate icons for different statuses:

```javascript
const icon = await ctx.call("notification.getStatusIcon", {
    status: "APPROVED",
});
// Returns: "check_circle"
```

## Service Actions

### `notification.send`

Send a notification using a template.

**Parameters:**

-   `templateKey` (string): Template key from config
-   `variables` (object): Variables to replace in template
-   `additionalData` (object): Additional notification data

### `notification.getBulkActionMessages`

Get bulk action messages for a specific action.

**Parameters:**

-   `action` (string): Action key

### `notification.getStatusIcon`

Get icon for a specific status.

**Parameters:**

-   `status` (string): Status key

### `notification.getTemplates`

Get all available templates.

### `notification.getBulkActions`

Get all available bulk actions.

### `notification.validateTemplate`

Validate template variables.

**Parameters:**

-   `templateKey` (string): Template key
-   `variables` (object): Variables to validate

## Migration from Old System

The old hardcoded notification system has been replaced with this centralized approach. All existing notification calls have been updated to use the new service.

### Before (Old System):

```javascript
let payload = {
    title: "New Contact",
    description: `${contactName} has been added to your contacts.`,
    // ... other fields
};
await ctx.call("supabase.insertData", { table: "notifications", payload });
```

### After (New System):

```javascript
await ctx.call("notification.send", {
    templateKey: "new_contact",
    variables: { contactName, contactId },
    additionalData: { organisation_id, branch_id, user_id },
});
```

## Benefits

1. **Centralized Management**: All notification content in one JSON file
2. **Variable Support**: Dynamic content replacement
3. **Type Safety**: Structured templates with validation
4. **Easy Maintenance**: Update content without code changes
5. **Reusability**: Templates can be reused across services
6. **Flexibility**: Support for different notification structures
7. **Internationalization Ready**: Easy to extend for multiple languages
8. **Version Control**: JSON file can be version controlled separately

## Error Handling

The system includes comprehensive error handling:

-   Template validation
-   Variable validation
-   Missing field detection
-   Detailed error logging

## Adding New Templates

To add a new notification template:

1. Add the template to `config/notifications.json`
2. Include required fields: `title`, `description`, `type`
3. Use variables with `{{variableName}}` syntax
4. Test the template using the validation action

Example:

```json
{
    "templates": {
        "new_template": {
            "title": "New Template",
            "description": "{{message}}",
            "icon": "info",
            "type": "custom",
            "link_template": "/path/{{id}}"
        }
    }
}
```

## List-Specific Bulk Actions

The system now includes specialized bulk actions for list operations with variable support:

### `add_to_list` Action

-   **Success Message**: "{{no_of_customers}} customer's added to {{listname}}"
-   **Variables**: `{{no_of_customers}}`, `{{listname}}`
-   **Usage**: Automatically triggered when customers are added to lists
-   **Example**: "5 customer's added to VIP Customers"

### `remove_from_list` Action

-   **Success Message**: "{{no_of_customers}} customer's removed from {{listname}}"
-   **Variables**: `{{no_of_customers}}`, `{{listname}}`
-   **Usage**: Automatically triggered when customers are removed from lists
-   **Example**: "3 customer's removed from Newsletter Subscribers"

These actions use the `bulk_action_success` template with dynamically processed success messages, providing more specific and informative notifications than generic bulk action messages. The system automatically replaces variables with actual values (customer count and list name) when sending notifications.
