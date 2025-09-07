import { NextResponse } from 'next/server'
import { Redis } from '@upstash/redis'
import { pingDatabase } from '../../../lib/postgres'

export async function GET() {
  const hasRedisUrl = !!process.env.UPSTASH_REDIS_REST_URL
  const hasRedisToken = !!process.env.UPSTASH_REDIS_REST_TOKEN
  const hasDatabaseUrl = !!process.env.DATABASE_URL
  
  let redisTest = null
  let redisError = null
  let postgresTest: { success: boolean; error?: string } | null = null
  
  if (hasRedisUrl && hasRedisToken) {
    try {
      const redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL!,
        token: process.env.UPSTASH_REDIS_REST_TOKEN!,
      })
      
      // Test Redis connection
      await redis.set('test-key', 'test-value')
      const testValue = await redis.get('test-key')
      await redis.del('test-key')
      
      redisTest = {
        success: true,
        testValue: testValue
      }
    } catch (error) {
      redisError = error instanceof Error ? error.message : 'Unknown error'
      redisTest = {
        success: false,
        error: redisError
      }
    }
  }

  return NextResponse.json({
    environment: process.env.NODE_ENV,
    hasRedisUrl,
    hasRedisToken,
    hasDatabaseUrl,
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    hasPublicGeminiKey: !!process.env.NEXT_PUBLIC_GEMINI_API_KEY,
    redisUrlPreview: hasRedisUrl ? 
      `${process.env.UPSTASH_REDIS_REST_URL!.substring(0, 40)}...` : 
      'NOT_SET',
    redisTest,
    postgresTest: postgresTest ?? (hasDatabaseUrl ? await (async () => {
      try {
        const ok = await pingDatabase()
        return { success: ok }
      } catch (e: any) {
        return { success: false, error: e?.message || 'Unknown error' }
      }
    })() : null),
    allEnvKeys: Object.keys(process.env).filter(key => 
      key.includes('REDIS') || key.includes('GEMINI') || key.includes('UPSTASH') || key.includes('POSTGRES') || key.includes('DATABASE_URL')
    )
  })
} 
