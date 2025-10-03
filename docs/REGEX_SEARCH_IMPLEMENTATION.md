# Regex Search Implementation for Customer Service

## Overview

This document describes the implementation of regex-based search functionality for the customer service, which addresses the limitations of MongoDB text search with partial text matching.

## Problem Statement

The existing MongoDB text search (`$text` operator) has limitations:
- Cannot perform partial text matching
- Requires exact word boundaries
- May miss relevant results when searching for partial terms

## Solution

Implemented a dual-search approach that supports both:
1. **Text Search** (existing functionality) - for exact matches
2. **Regex Search** (new functionality) - for partial text matching

## Implementation Details

### 1. Enhanced CreateAggregation Function

The `CreateAggregation` function in `utils/common.js` now supports a `useRegexSearch` parameter:

```javascript
function CreateAggregation(org_id, branch_id, search, first, last, filter, after, before, deleteflag = true, useRegexSearch = false)
```

### 2. New Regex Search Function

Added `createRegexSearchQuery` function that:
- Escapes special regex characters to prevent injection attacks
- Creates case-insensitive regex patterns
- Supports multiple search fields
- Implements a scoring system for result ranking

### 3. Search Fields Supported

Regex search works on the following customer fields:
- `name` (score: 10)
- `email` (score: 8)
- `phone` (score: 6)
- `state` (score: 4)
- `country` (score: 4)
- `note` (score: 2)

### 4. Scoring System

Results are ranked by relevance using a scoring system:
- Higher scores indicate better matches
- Matches in name field get highest priority
- Multiple field matches increase overall score

## API Endpoints

### 1. Traditional Text Search (Existing)
```
GET /api/customer/audience?search=john&page=1&pageSize=10
```

### 2. New Regex Search Endpoint
```
GET /api/customer/audience/regex-search?search=john&page=1&pageSize=10
```

### 3. Configurable Search Endpoint
```
GET /api/customer/audience/search?search=john&useRegexSearch=true&page=1&pageSize=10
```

## Usage Examples

### Example 1: Partial Name Search
**Search Term**: "john"
- **Text Search**: May find "john" but miss "johnny", "johnson"
- **Regex Search**: Will find "john", "johnny", "johnson", "johnathan"

### Example 2: Partial Email Search
**Search Term**: "gmail"
- **Text Search**: May not find "user@gmail.com"
- **Regex Search**: Will find "user@gmail.com", "test@gmail.com"

### Example 3: Partial Phone Search
**Search Term**: "123"
- **Text Search**: May not find "123-456-7890"
- **Regex Search**: Will find "123-456-7890", "123.456.7890"

### Example 4: Case-Insensitive Search
**Search Term**: "JOHN"
- **Text Search**: May not find "john"
- **Regex Search**: Will find "john", "John", "JOHN"

## Security Features

1. **Regex Injection Prevention**: All special characters are escaped
2. **Input Validation**: Search terms are validated before processing
3. **Permission Checks**: All endpoints require proper authentication and authorization

## Performance Considerations

1. **Indexing**: Ensure proper indexes exist on search fields
2. **Result Limiting**: Pagination is implemented to limit result sets
3. **Scoring**: Custom scoring reduces the need for complex post-processing

## Migration Guide

### For Existing Applications

1. **No Breaking Changes**: Existing text search functionality remains unchanged
2. **Gradual Adoption**: Can gradually migrate to regex search where needed
3. **Hybrid Approach**: Use both methods based on specific use cases

### For New Implementations

1. **Default to Regex**: Set `useRegexSearch=true` for better partial matching
2. **Fallback Support**: Can fall back to text search if needed
3. **Performance Testing**: Test with your specific data volumes

## Testing

### Unit Tests
Run the existing test suite to ensure no regressions:
```bash
npm test
```

### Integration Tests
Test the new endpoints with various search scenarios:
```bash
# Test regex search
curl "http://localhost:3000/api/customer/audience/regex-search?search=john&page=1&pageSize=10"

# Test configurable search with regex
curl "http://localhost:3000/api/customer/audience/search?search=john&useRegexSearch=true&page=1&pageSize=10"
```

## Troubleshooting

### Common Issues

1. **No Results Found**
   - Check if search term contains special characters
   - Verify field values exist in the database
   - Ensure proper indexes are in place

2. **Performance Issues**
   - Review database indexes
   - Check query execution plans
   - Consider limiting search fields if not all are needed

3. **Permission Errors**
   - Verify user has proper scopes (`customer_read`, `customer_write`, or `full_control`)
   - Check organization and branch access

## Future Enhancements

1. **Fuzzy Search**: Implement fuzzy matching for typos
2. **Search Suggestions**: Add autocomplete functionality
3. **Advanced Filtering**: Support for complex search queries
4. **Search Analytics**: Track search patterns and optimize results

## Support

For questions or issues related to the regex search implementation:
1. Check this documentation
2. Review the code comments
3. Test with the provided examples
4. Contact the development team if issues persist

