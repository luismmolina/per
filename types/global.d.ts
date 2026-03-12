/// <reference types="react" />
/// <reference types="react-dom" />

declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}

declare module 'react-markdown' {
  import React from 'react';
  
  interface ReactMarkdownProps {
    children: string;
    remarkPlugins?: any[];
    components?: {
      [key: string]: React.ComponentType<any>;
    };
  }
  
  const ReactMarkdown: React.FC<ReactMarkdownProps>;
  export default ReactMarkdown;
}

declare module 'remark-gfm' {
  const remarkGfm: any;
  export default remarkGfm;
}

declare namespace NodeJS {
  interface ProcessEnv {
    GEMINI_API_KEY: string;
    GEMINI_EMBEDDING_MODEL?: string;
    GEMINI_EMBEDDING_DIMENSIONS?: string;
    GEMINI_RERANK_MODEL?: string;
    ENABLE_GEMINI_NOTE_RETRIEVAL?: string;
    OPENROUTER_API_KEY?: string;
    OPENROUTER_MODEL?: string;
    OPENROUTER_LONGFORM_MODEL?: string;
    GROQ_API_KEY?: string;
    DATABASE_URL?: string;
    NODE_ENV: 'development' | 'production' | 'test';
    [key: string]: string | undefined;
  }
  
  interface Timeout {
    ref(): Timeout;
    unref(): Timeout;
  }
} 
