import type { AskResult } from './api';

export interface ChatMsg {
  id: number;
  role: 'me' | 'ai';
  text: string; // user prompt, or the model's answer
  result?: AskResult; // present on completed ai messages
  pending?: boolean; // ai placeholder while the engine works
  error?: string;
}
