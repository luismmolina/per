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
    NODE_ENV: 'development' | 'production' | 'test';
    [key: string]: string | undefined;
  }
  
  interface Timeout {
    ref(): Timeout;
    unref(): Timeout;
  }
} 
