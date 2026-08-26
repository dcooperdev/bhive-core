import { Tool } from '../../src/types';

export const mockClassifyTool: Tool = {
  name: 'classify_email',
  description: 'Classify email as VIP, SPAM, or NORMAL',
  execute: async (params: { from: string; subject: string }) => {
    const vips = ['boss@company.com', 'ceo@company.com'];
    if (vips.some(v => params.from.includes(v))) {
      return JSON.stringify({ classification: 'VIP' });
    }
    return JSON.stringify({ classification: 'NORMAL' });
  }
};

export const mockLabelTool: Tool = {
  name: 'apply_label',
  description: 'Apply label to email',
  execute: async (params: { emailId: string; label: string }) => {
    return `Labeled ${params.emailId} as ${params.label}`;
  }
};

export const mockNotifyTool: Tool = {
  name: 'notify_user',
  description: 'Notify user',
  execute: async (params: { message: string }) => {
    return `Notified: ${params.message}`;
  }
};

export const allMockTools = [
  mockClassifyTool,
  mockLabelTool,
  mockNotifyTool
];
