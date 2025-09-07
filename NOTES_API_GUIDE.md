# Notes API Guide

## Overview

The Notes API endpoint (`/api/notes`) provides a comprehensive view of all available notes, including both user-generated notes and automatically extracted notes from the COGS (Cost of Goods Sold) system. This endpoint consolidates data from multiple sources into a unified format for easy consumption and analysis.

## API Endpoint

**URL**: `/api/notes`  
**Method**: GET  
**Content-Type**: `application/json`

## Response Structure

```json
{
  "notes": [
    {
      "id": "unique-note-id",
      "content": "Note content with details...",
      "type": "user-note|cogs-summary|cogs-dish|cogs-calculation|cogs-buffet",
      "timestamp": "2025-01-15T10:30:00.000Z",
      "source": "User Input|COGS API",
      "metadata": {
        // Additional structured data specific to note type
      }
    }
  ],
  "metadata": {
    "totalNotes": 25,
    "userNotes": 10,
    "cogsNotes": 15,
    "notesByType": {
      "user-note": 10,
      "cogs-summary": 1,
      "cogs-dish": 9,
      "cogs-calculation": 4,
      "cogs-buffet": 1
    },
    "lastUpdated": "2025-01-15T10:30:00.000Z",
    "sources": ["User Input", "COGS API"]
  }
}
```

## Note Types

### 1. User Notes (`user-note`)
- **Source**: User-generated notes from the conversation interface
- **Content**: Free-form text entered by users
- **Metadata**: Basic note information
- **Example**: Business insights, observations, ideas

### 2. COGS Summary (`cogs-summary`)
- **Source**: COGS API
- **Content**: Overall summary of dishes in production
- **Metadata**: Total dishes count, last updated timestamp, buffet statistics
- **Example**: "📊 DISHES SUMMARY: 9 dishes in production. Last updated: 2025-01-15"

### 3. COGS Dish (`cogs-dish`)
- **Source**: COGS API
- **Content**: Individual dish information with production costs
- **Metadata**: Dish name, cost details, buffet categories, last updated
- **Example**: "🍽️ Pasta al mojo de ajo: 25.69 MXN to produce (updated: 2025-01-15)"

### 4. COGS Calculation (`cogs-calculation`)
- **Source**: COGS API (when calculation notes are available)
- **Content**: Detailed cost breakdown analysis for specific dishes
- **Metadata**: Dish name, cost details, calculation timestamp
- **Example**: Detailed ingredient-by-ingredient cost analysis with yield calculations

### 5. COGS Buffet (`cogs-buffet`)
- **Source**: COGS API (when buffet statistics are available)
- **Content**: Buffet pricing and cost statistics
- **Metadata**: Buffet statistics, average costs, COGS per customer
- **Example**: Buffet pricing breakdown for basic and premium options

## Data Sources

### 1. User Input
- **Storage**: Redis cloud database or local file storage
- **Retrieval**: From conversations API
- **Filtering**: Only notes (not questions or AI responses)
- **Format**: Original user content with timestamps

### 2. COGS API
- **Endpoint**: `https://cogs-two.vercel.app/api/dishes/prices`
- **Data**: Production costs, calculation notes, buffet statistics
- **Transformation**: Converted to note format for consistency
- **Real-time**: Fetched fresh on each API call

## Usage Examples

### 1. Basic API Call

```javascript
const response = await fetch('/api/notes', {
  method: 'GET',
  headers: {
    'Content-Type': 'application/json',
  },
})

const data = await response.json()
console.log(`Total notes: ${data.metadata.totalNotes}`)
```

### 2. Filter by Note Type

```javascript
const response = await fetch('/api/notes')
const data = await response.json()

// Get only COGS calculation notes
const calculationNotes = data.notes.filter(note => note.type === 'cogs-calculation')

// Get only user notes
const userNotes = data.notes.filter(note => note.type === 'user-note')
```

### 3. Search for Specific Content

```javascript
const response = await fetch('/api/notes')
const data = await response.json()

// Search for notes containing "cost" or "price"
const costRelatedNotes = data.notes.filter(note => 
  note.content.toLowerCase().includes('cost') || 
  note.content.toLowerCase().includes('price')
)
```

### 4. Get Latest Notes

```javascript
const response = await fetch('/api/notes')
const data = await response.json()

// Notes are already sorted by timestamp (newest first)
const latestNotes = data.notes.slice(0, 10) // Get 10 most recent notes
```

## Error Handling

The API returns appropriate HTTP status codes and error messages:

### Success Response
- **Status**: 200 OK
- **Body**: Complete notes data with metadata

### Error Responses
- **Status**: 500 Internal Server Error
- **Body**: Error message with empty notes array and metadata

```json
{
  "error": "Failed to retrieve notes",
  "notes": [],
  "metadata": {
    "totalNotes": 0,
    "userNotes": 0,
    "cogsNotes": 0,
    "notesByType": {},
    "lastUpdated": "2025-01-15T10:30:00.000Z",
    "sources": []
  }
}
```

## CORS Support

The API includes CORS headers for cross-origin requests:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

## Performance Considerations

### 1. Data Retrieval
- User notes are loaded from Redis or local file storage
- COGS data is fetched fresh from external API on each request
- All data is combined and sorted by timestamp

### 2. Caching
- No built-in caching to ensure fresh COGS data
- Consider implementing client-side caching for performance
- User notes are already cached in Redis/local storage

### 3. Rate Limiting
- No built-in rate limiting
- Consider implementing if needed for production use

## Testing

Use the provided test script to verify the API functionality:

```bash
# Test locally
node scripts/test-notes-api.js

# Test against deployed instance
API_URL=https://your-deployed-app.vercel.app node scripts/test-notes-api.js
```

## Integration with AI

The notes API can be used to provide comprehensive context to AI systems:

### 1. Business Analysis
- Combine user insights with production cost data
- Analyze cost trends and optimization opportunities
- Generate comprehensive business reports

### 2. Decision Support
- Use historical notes with current cost data
- Identify patterns and correlations
- Support data-driven decision making

### 3. Automated Insights
- Feed all notes to AI for analysis
- Generate automated recommendations
- Identify cost optimization opportunities

## Future Enhancements

### 1. Filtering Options
- Add query parameters for filtering by type, date range, source
- Support for full-text search
- Pagination for large datasets

### 2. Real-time Updates
- WebSocket support for real-time note updates
- Event-driven architecture for live data

### 3. Advanced Analytics
- Built-in analytics and reporting
- Trend analysis and forecasting
- Anomaly detection

## Troubleshooting

### Common Issues

1. **No COGS Notes**: Check if the external COGS API is accessible
2. **No User Notes**: Verify Redis configuration or local file storage
3. **CORS Errors**: Ensure proper CORS headers are set
4. **Performance Issues**: Consider implementing caching strategies

### Debug Information

The API provides detailed console logging for debugging:

```
📝 Notes API: Fetching all notes including COGS data...
🍽️ Fetching dishes data for notes endpoint...
📝 Using Redis for loading user notes
📝 Notes API: Successfully compiled notes: { totalNotes: 25, userNotes: 10, cogsNotes: 15 }
```

## Security Considerations

1. **Data Privacy**: Ensure sensitive business data is properly protected
2. **API Access**: Consider implementing authentication for production use
3. **Rate Limiting**: Implement rate limiting to prevent abuse
4. **Input Validation**: Validate and sanitize all inputs

## Support

For issues or questions about the Notes API:

1. Check the console logs for detailed error information
2. Verify the external COGS API is accessible
3. Test with the provided test script
4. Review the error handling section above