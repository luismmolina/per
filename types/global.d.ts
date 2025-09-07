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

declare module 'lucide-react' {
  import React from 'react';
  
  interface IconProps {
    className?: string;
    size?: number | string;
    [key: string]: any;
  }
  
  export const Plus: React.FC<IconProps>;
  export const Send: React.FC<IconProps>;
  export const Bot: React.FC<IconProps>;
  export const User: React.FC<IconProps>;
  export const Scissors: React.FC<IconProps>;
  export const Search: React.FC<IconProps>;
  export const Copy: React.FC<IconProps>;
  export const Check: React.FC<IconProps>;
  export const Download: React.FC<IconProps>;
  export const Trash: React.FC<IconProps>;
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