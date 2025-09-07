// Minimal shims to keep the TS server happy when types are unavailable

// next/server basic types
declare module 'next/server' {
  export type NextRequest = any
  export const NextResponse: any
}

// @google/genai minimal surface
declare module '@google/genai' {
  export class GoogleGenAI {
    constructor(opts: any)
    models: any
  }
  export type Content = any
  export enum HarmCategory {}
  export enum HarmBlockThreshold {}
}

// Note: Do not declare 'process' here to avoid conflicting with @types/node in build environments.

// AsyncGenerator type if not present in lib
interface AsyncGenerator<T = any, TReturn = any, TNext = any>
  extends AsyncIterableIterator<T> {}
