# Archive User Functionality

## Overview

This document describes the implementation of archive user functionality in the UMS (User Management System). Users can be archived per organization, preventing them from switching to that specific organization while maintaining access to other organizations where they have active status.

## Features

### 1. Archive User

-   **Endpoint**: `POST /user/archive`
-   **Access**: Admin users only (requires `full_control` scope)
-   **Parameters**:
    -   `user_id` (string): ID of the user to archive
-   **Behavior**: Archives the user in the current organization only
-   **Prevention**: Users cannot archive themselves

### 2. Unarchive User

-   **Endpoint**: `POST /user/unarchive`
-   **Access**: Admin users only (requires `full_control` scope)
-   **Parameters**:
    -   `user_id` (string): ID of the user to unarchive
-   **Behavior**: Unarchives the user in the current organization only

### 3. Get User Archive Status

-   **Endpoint**: `GET /user/archive-status`
-   **Access**: Admin users only (requires `full_control` scope)
-   **Parameters**:
    -   `user_id` (string): ID of the user to check
-   **Response**: Shows user's status across all organizations

### 4. List Users with Organization Status

-   **Endpoint**: `GET /user`
-   **Access**: Authenticated users
-   **Response**: Lists all users in current organization with their status

## Organization Switching

### Archive Status Check

When a user attempts to switch organizations via `GET /switch-org/:id`:

-   System checks if user is archived in the target organization
-   If archived: Returns "Access denied: User is archived in this organization"
-   If active: Allows organization switch to proceed

### Multi-Organization Access

-   Users can be archived in one organization but active in others
-   Archive status is organization-specific, not global
-   Users maintain access to organizations where they have active status

## Database Changes

### Indexes Added

-   `{ user_id: 1, org_id: 1 }` - Unique constraint for user-organization pairs
-   `{ org_id: 1, status: 1 }` - Efficient queries by organization and status
-   `{ user_id: 1, status: 1 }` - Efficient queries by user and status
-   `{ status: 1, updated_at: 1 }` - Efficient queries by status and update time

## Security Features

### Permission Checks

-   Only users with `full_control` scope can archive/unarchive users
-   Users cannot archive themselves
-   Archive actions are limited to the current organization context

### Data Isolation

-   Archive status is stored per organization
-   No cross-organization data leakage
-   Proper multi-tenant architecture maintained

## Usage Examples

### Archive a User

```bash
POST /user/archive
Authorization: Bearer <token>
Content-Type: application/json

{
  "user_id": "507f1f77bcf86cd799439011"
}
```

### Unarchive a User

```bash
POST /user/unarchive
Authorization: Bearer <token>
Content-Type: application/json

{
  "user_id": "507f1f77bcf86cd799439011"
}
```

### Check User Archive Status

```bash
GET /user/archive-status?user_id=507f1f77bcf86cd799439011
Authorization: Bearer <token>
```

## Error Handling

### Common Error Messages

-   `"Permission denied: Only admin users can archive users"`
-   `"Cannot archive yourself"`
-   `"User not found in this organization or already archived"`
-   `"Access denied: User is archived in this organization"`

### Error Responses

All errors return appropriate HTTP status codes and descriptive error messages in the response body.

## Implementation Notes

### Files Modified

1. `services/ums/ums_user.service.js` - Added archive/unarchive actions
2. `services/ums/ums_organisation.service.js` - Updated switchOrganisation action
3. `models/ums/user_organisations.model.js` - Added database indexes

### Dependencies

-   Requires existing UMS infrastructure
-   Uses `user_organisations` collection for status tracking
-   Integrates with existing role-based access control system

## Testing Considerations

### Test Scenarios

1. Admin user archiving another user
2. Admin user unarchiving a user
3. Non-admin user attempting to archive users
4. User attempting to archive themselves
5. Archived user attempting to switch organizations
6. Active user successfully switching organizations
7. Multi-organization user access patterns

### Edge Cases

-   User archived in one organization but active in others
-   Organization deletion with archived users
-   Role changes for archived users
-   Bulk operations on archived users
