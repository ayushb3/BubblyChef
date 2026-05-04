import { test as base, expect } from '@playwright/test';
import path from 'path';

export const test = base.extend({});
export { expect };

test.use({ storageState: path.join(__dirname, '../.auth/user.json') });
