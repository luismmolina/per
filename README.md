# Contextual Assistant

A smart journal app that combines note-taking with AI-powered insights. Built with Next.js, React, and TypeScript.

## Features

- **Unified Conversation View**: Everything happens in one timeline - your notes and AI responses
- **Two-Action Interface**: Simply type and choose to either "Add Note" or "Ask AI"
- **Smart Context**: AI receives only your notes (not questions) as context for intelligent responses
- **Production Cost Integration**: Automatically fetches and includes current production cost data from your API
- **Profit Opportunity Finder**: Click the lens icon to discover the highest-probability opportunity to increase profits
- **Conversation Management**: Delete individual notes, prune conversations and download notes with timestamps
- **Persistent Storage**: Your conversations are automatically saved and restored between sessions
- **Clean, Modern UI**: Chat-like interface with distinct styling for notes vs AI responses
- **Responsive Design**: Works seamlessly on desktop and mobile
- **Code Execution**: AI can run Python code for precise mathematical calculations
- **First Principles Thinking**: Enhanced AI prompts for rigorous business analysis

## Getting Started

1. **Install dependencies:**

   ```bash
   npm install
   ```

   Copy `.env.example` to `.env.local` and add your Gemini API key and Postgres `DATABASE_URL`.

2. **Run the development server:**

   ```bash
   npm run dev
   ```

3. **Open your browser:**
   Navigate to [http://localhost:3000](http://localhost:3000)

4. **If you can't connect to Gemini:**

   - Call [http://localhost:3000/api/debug](http://localhost:3000/api/debug) to verify your environment
   - You may need a new API key from [Google AI Studio](https://ai.google.dev/)

## How to Use

1. **Adding Notes**: Type your thoughts, ideas, or information and click "Add Note" to save them to your knowledge base
2. **Asking Questions**: Type a question and click "Ask AI" to get contextual responses based on all your previous notes
3. **Find Profit Opportunity**: Click the lens icon (🔍) to get the most promising way to increase profits
4. **Managing Conversations**: Use the trash icon (🗑️) to delete a note, the scissors icon (✂️) to clean up conversations, and the download icon (📥) to export notes
5. **Smart Context**: Only your notes (not questions or AI responses) are sent to the AI as context

## Message Types & Context

**🟢 Notes (Green)** - Knowledge/facts that ARE sent to AI:

- "I work at TechCorp as a software engineer"
- "My favorite programming language is Python"
- "I'm learning React and Next.js"

**🔵 Questions (Blue)** - Queries that are NOT sent to AI:

- "What do I do for work?"
- "What are my favorite technologies?"
- "Help me plan my learning path"

**⚪ AI Responses (White)** - Responses that are NOT sent to AI:

- AI answers and error messages

**Why this matters:** This prevents questions from polluting your knowledge base and ensures the AI only receives relevant context.

## Production Cost Integration

The app automatically fetches current production cost data from your API endpoint (`https://cogs-two.vercel.app/api/dishes/prices`) and includes it in the context sent to the AI. This enables:

- **Real-time cost analysis** - AI can analyze current production costs and cost structures
- **Profit margin calculations** - Precise calculations using actual production costs
- **Cost optimization insights** - Identify high-cost items and optimization opportunities
- **Pricing strategy recommendations** - Data-driven recommendations based on production costs

The production cost data includes:

- Dish names and production costs
- Last updated timestamps
- Total number of dishes in production
- Currency information (MXN)
- **Detailed cost breakdowns** - Calculation notes showing ingredient-by-ingredient cost analysis

**Example usage:**

- "What's the average production cost of my dishes?"
- "Which dishes have the highest production costs?"
- "How much would it cost to produce 10 of each dish?"
- "What's the total production cost for my current menu?"
- "Which dishes should I consider for cost optimization?"
- "Show me the detailed cost breakdown for Pasta al mojo de ajo"
- "Which ingredients contribute most to the cost of Taco Costa Coral?"
- "Analyze the yield percentages in my cost calculations"

## Enhanced AI Capabilities

### First Principles Thinking
The AI uses enhanced prompts that encourage:
- **Rigorous analytical methods** with practical business insights
- **First principles thinking** to break down complex problems
- **Physics principles** (thermodynamics, fluid dynamics, optimization) when applicable
- **Bayesian statistics** for uncertainty quantification
- **Mathematical precision** - business decisions often hinge on 1% differences

### Code Execution
- **Python code execution** for all mathematical calculations
- **Precise financial calculations** with proper rounding
- **Confidence intervals** and uncertainty estimates
- **Step-by-step calculations** shown in code blocks

### Profit Opportunity Finder
Click the lens icon to get AI-powered insights on:
- The single opportunity most likely to increase profits
- A short explanation of why it has a high chance of success

## Tech Stack

- **Framework**: Next.js 14 with App Router
- **Frontend**: React 18 with TypeScript
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **State Management**: React useState (local state)
- **AI**: Google Gemini 2.5 Pro with enhanced prompts

## API Configuration

The app uses Google's Gemini AI API. **If you're experiencing connection issues:**

1. **Run diagnostics**: Visit `/api/debug` in your browser to verify environment variables
2. **Check your API key**: If diagnostics fail with "API key not valid", you need a new key
3. **Get a new API key**: Go to [Google AI Studio](https://ai.google.dev/) → "Get API Key" → "Create API Key"
4. **Configure environment**: Copy `.env.example` to `.env.local` and fill in the required keys

For production use, keep your keys only in environment variables, never in source code.

## Data Storage

- **Primary Storage**: Neon Postgres (via `@neondatabase/serverless`)
- **Data Shape**: Stored as a single JSON document keyed by `contextual-conversations`
- **Auto-Save**: Every message is automatically saved via API calls
- **Cloud Persistence**: Your conversations are stored securely in Postgres

### Environment Setup

Add these environment variables to your `.env.local` (values shown are examples):
```
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DB?sslmode=require
# Optional alternates if you use them elsewhere
DATABASE_URL_UNPOOLED=...
PGHOST=...
PGUSER=...
PGDATABASE=...
PGPASSWORD=...
```

Install the Postgres client:
```
npm install @neondatabase/serverless
```

## Development

- `npm run dev` - Start development server
- `npm run build` - Create production build
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

## License

Proprietary License - All Rights Reserved

This software is protected by copyright and proprietary rights. Commercial use, 
distribution, or modification requires explicit written permission from the 
copyright holder.

For licensing inquiries, please contact the copyright holder.
